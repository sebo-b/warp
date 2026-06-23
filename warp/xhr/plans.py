import os

import flask
from peewee import JOIN, fn, EXCLUDED
from jsonschema import validate, ValidationError
import orjson

from warp.db import *
from warp import utils
from warp.utils_tabulator import *
from warp import blob_storage

bp = flask.Blueprint('plans', __name__, url_prefix='plans')


@bp.route("list", endpoint='list', methods=["POST"])
@utils.validateJSONInput(tabulatorSchema, isAdmin=True)
def listW():
    requestData = flask.request.get_json()

    seatCountQuery = Seat.select(Seat.pid, COUNT_STAR.alias('seat_count')) \
        .group_by(Seat.pid)

    query = Plan.select(
        Plan.id, Plan.name,
        fn.COALESCE(seatCountQuery.c.seat_count, 0).alias('seat_count')
    ) \
        .join(seatCountQuery, join_type=JOIN.LEFT_OUTER, on=(Plan.id == seatCountQuery.c.pid))

    # Intercept the "zone_names" filter before applyTabulatorToQuery since zone_names
    # is a virtual field (added post-query). Translate it to a WHERE EXISTS clause.
    zoneFilter = None
    if 'filter' in requestData:
        kept = []
        for f in requestData['filter']:
            if f.get('field') == 'zone_names' and f.get('value'):
                zoneFilter = f['value']
            else:
                kept.append(f)
        requestData['filter'] = kept

    if zoneFilter:
        # Plans that have at least one seat in the given zone.
        # Uses an IN subquery (avoids correlated subquery issues with Peewee).
        query = query.where(
            Plan.id.in_(
                Seat.select(Seat.pid)
                .join(Zone, on=(Seat.zid == Zone.id))
                .where(Zone.name == zoneFilter)
            )
        )

    (query, lastPage) = applyTabulatorToQuery(query, requestData)

    res_data = list(query.iterator())

    if res_data:
        pids = [row['id'] for row in res_data]
        zone_rows = Zone.select(Seat.pid, Zone.name) \
            .join(Seat, on=(Seat.zid == Zone.id)) \
            .where(Seat.pid.in_(pids)) \
            .group_by(Seat.pid, Zone.name) \
            .order_by(Zone.name) \
            .tuples()
        zones_by_pid = {}
        for row in zone_rows:
            zones_by_pid.setdefault(row[0], []).append(row[1])
        for row in res_data:
            row['zone_names'] = zones_by_pid.get(row['id'], [])

    res = {"data": res_data}
    if lastPage is not None:
        res["last_page"] = lastPage
    return res, 200


deleteSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id": {"type": "integer"},
    },
    "required": ["id"]
}


@bp.route("delete", methods=["POST"])
@utils.validateJSONInput(deleteSchema, isAdmin=True)
def delete():
    jsonData = flask.request.get_json()
    pid = jsonData['id']

    try:
        with DB.atomic():
            blob_storage.deleteBlob(
                blobIdQuery=Plan.select(Plan.iid).where(Plan.id == pid))
            Plan.delete().where(Plan.id == pid).execute()
    except IntegrityError:
        return {"msg": "Error", "code": 320}, 400

    return {"msg": "ok"}, 200


addOrEditSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id": {"type": "integer"},
        "name": {"type": "string", "minLength": 1},
    },
    "required": ["name"]
}


@bp.route("addoredit", methods=["POST"])
@utils.validateJSONInput(addOrEditSchema, isAdmin=True)
def addOrEdit():
    jsonData = flask.request.get_json()

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():
            updColumns = {
                Plan.name: jsonData['name'],
            }

            if 'id' in jsonData:
                rowCount = Plan.update(updColumns).where(Plan.id == jsonData['id']).execute()
                if rowCount != 1:
                    raise ApplyError("Wrong number of affected rows", 321)
            else:
                Plan.insert(updColumns).execute()

    except IntegrityError:
        return {"msg": "Error", "code": 322}, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1]}, 400

    return {"msg": "ok"}, 200


@bp.route("getSeats/<int:pid>")
def getSeats(pid):
    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 350}, 403

    query = Seat.select(Seat.id, Seat.zid, Seat.name, Seat.x, Seat.y) \
        .where(Seat.pid == pid)

    res = {
        str(i['id']): {
            "zid": i['zid'],
            "name": i['name'],
            "x": i['x'],
            "y": i['y'],
        } for i in query.iterator()
    }

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')


# Multipart endpoint: optional 'image' file + JSON in 'json' field.
# JSON format:
# {
#   pid: 10,
#   addOrUpdate: [
#       {name: "seat 1", x: 10, y: 10, zid: 7}                 # new seat (must include explicit zid)
#       {name: "seat 2", x: 10, y: 10, zid: 5}
#       {sid: 20, name: "old seat 3", x: 20, y: 20}
#       {sid: 30, zid: 4}
#   ],
#   remove: [sid, sid, ...]
# }
@bp.route("modify", methods=["POST"])
def modify():
    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 330}, 403

    imageFile = flask.request.files.get('image', None)
    if imageFile is not None:
        mimeType = None
        allowedMagics = [
            (b'\xFF\xD8\xFF\xDB', "image/jpeg"),
            (b'\xFF\xD8\xFF\xE0\x00\x10\x4A\x46\x49\x46\x00\x01', "image/jpeg"),
            (b'\xFF\xD8\xFF\xEE', "image/jpeg"),
            (b'\xFF\xD8\xFF\xE1', "image/jpeg"),
            (b'\x89\x50\x4E\x47\x0D\x0A\x1A\x0A', "image/png"),
        ]
        magic = imageFile.stream.read(12)
        for i in allowedMagics:
            if magic.startswith(i[0]):
                mimeType = i[1]
                break
        else:
            return {"msg": "Wrong file format", "code": 331}, 400

        imageFile.stream.seek(0, os.SEEK_END)
        if imageFile.stream.tell() > flask.current_app.config['MAX_MAP_SIZE']:
            return {"msg": "Image too big", "code": 332}, 400
        imageFile.stream.seek(0, os.SEEK_SET)

    jsonData = flask.request.form.get('json', None)

    jsonSchema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "pid": {"type": "integer"},
            "addOrUpdate": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "sid": {"type": "integer"},
                        "zid": {"type": "integer"},
                        "name": {"type": "string"},
                        "x": {"type": "integer"},
                        "y": {"type": "integer"},
                    },
                    "anyOf": [
                        {"required": ["sid"]},
                        {"required": ["name", "x", "y"]},
                    ],
                },
            },
            "remove": {
                "type": "array",
                "items": {"type": "integer"},
            },
            "darkFilter": {"type": "object"},
        },
        "required": ["pid"],
        "additionalProperties": False
    }

    try:
        jsonData = orjson.loads(jsonData)
        validate(jsonData, jsonSchema)
    except orjson.JSONDecodeError:
        return {"msg": "Error in parsing JSON", "code": 333}, 400
    except ValidationError:
        return {"msg": "Data error", "code": 334}, 400

    class ApplyError(Exception):
        pass

    pid = jsonData['pid']

    try:
        with DB.atomic():

            if imageFile is not None:
                planRow = Plan.select(Plan.iid).where(Plan.id == pid).scalar(as_tuple=True)
                if planRow is None:
                    raise ApplyError("Wrong pid", 335)
                blobId = planRow[0]
                newBlobId = blob_storage.addOrUpdateBlob(mimeType, imageFile.stream.read(), blobId)
                if newBlobId is None:
                    raise ApplyError("Blob not created", 336)
                if blobId != newBlobId:
                    Plan.update({Plan.iid: newBlobId}).where(Plan.id == pid).execute()

            if 'remove' in jsonData:
                rowCount = Seat.delete() \
                    .where(Seat.id.in_(jsonData['remove']) & (Seat.pid == pid)) \
                    .execute()
                if rowCount != len(jsonData['remove']):
                    raise ApplyError("Wrong number of affected rows", 337)

            if 'addOrUpdate' in jsonData:

                columnsMap = {
                    'sid': Seat.id,
                    'zid': Seat.zid,
                    'name': Seat.name,
                    'x': Seat.x,
                    'y': Seat.y,
                }

                dataInsert = []
                totalCount = 0
                for i in jsonData['addOrUpdate']:
                    entry = {}
                    for column, value in i.items():
                        if column in columnsMap:
                            entry[columnsMap[column]] = value

                    if Seat.id in entry:
                        sid = entry.pop(Seat.id)
                        if entry:
                            rowCount = Seat.update(entry) \
                                .where((Seat.id == sid) & (Seat.pid == pid)) \
                                .execute()
                            totalCount += rowCount
                        else:
                            totalCount += 1  # no-op update still counts
                    else:
                        entry[Seat.pid] = pid
                        dataInsert.append(entry)

                if dataInsert:
                    rowCount = Seat.insert(dataInsert).as_rowcount().execute()
                    totalCount += rowCount

                if totalCount != len(jsonData['addOrUpdate']):
                    raise ApplyError("Wrong number of affected rows", 338)

            if 'darkFilter' in jsonData:
                Plan.update({Plan.dark_filter: orjson.dumps(jsonData['darkFilter']).decode('utf-8')}).where(Plan.id == pid).execute()

    except IntegrityError:
        # e.g. a new seat without a valid zid, or a stale pid/sid reference.
        return {"msg": "Error", "code": 339}, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1]}, 400

    return {"msg": "ok"}, 200


@bp.route("zonesForPlan", methods=["GET"])
def zonesForPlan():
    """Return all zones that have at least one seat on the given plan (admin use)."""
    if not flask.g.isAdmin:
        flask.abort(403)
    pid = flask.request.args.get('pid', type=int)
    if pid is None:
        return [], 200
    rows = Zone.select(Zone.id, Zone.name) \
        .join(Seat, on=(Seat.zid == Zone.id)) \
        .where(Seat.pid == pid) \
        .group_by(Zone.id, Zone.name) \
        .order_by(Zone.name)
    return flask.jsonify([{'id': r['id'], 'name': r['name']} for r in rows])


@bp.route("allZones", methods=["GET"])
def allZones():
    """Return all zones (for per-seat zone selector in the plan map editor)."""
    if not flask.g.isAdmin:
        flask.abort(403)
    rows = Zone.select(Zone.id, Zone.name).order_by(Zone.name)
    return flask.jsonify([{'id': r['id'], 'name': r['name']} for r in rows])
