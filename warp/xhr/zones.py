import os

import flask
from peewee import JOIN, fn, EXCLUDED
from jsonschema import validate, ValidationError
import orjson

from warp.db import *
from warp import utils
from warp.utils_tabulator import *
from warp import blob_storage

bp = flask.Blueprint('zones', __name__, url_prefix='zones')

@bp.route("list", endpoint='list', methods=["POST"])
@utils.validateJSONInput(tabulatorSchema,isAdmin=True)
def listW():              #list is a built-in type

    requestData = flask.request.get_json()

    countQuery = UserToZoneRoles.select( \
            UserToZoneRoles.zid, \
            COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_ADMIN).alias("admins"), \
            COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_USER).alias("users"), \
            COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_VIEWER).alias("viewers")) \
        .group_by(UserToZoneRoles.zid)
    query = Zone.select(Zone.id, Zone.name, Zone.zone_group,
                        fn.COALESCE(countQuery.c.admins,0).alias('admins'),
                        fn.COALESCE(countQuery.c.users,0).alias('users'),
                        fn.COALESCE(countQuery.c.viewers,0).alias('viewers')) \
                .join(countQuery, join_type=JOIN.LEFT_OUTER, on=(Zone.id == countQuery.c.zid))

    (query, lastPage) = applyTabulatorToQuery(query,requestData)

    res = { "data": [ *query.iterator() ] }

    if lastPage is not None:
        res["last_page"] = lastPage

    return res, 200



deleteSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id" : {"type" : "integer"},
    },
    "required": [ "id" ]
}

# Format:
# { id: id }
@bp.route("delete", methods=["POST"])
@utils.validateJSONInput(deleteSchema,isAdmin=True)
def delete():

    jsonData = flask.request.get_json()
    id = jsonData['id']

    try:
        with DB.atomic():

            blob_storage.deleteBlob(
                blobIdQuery = Zone.select(Zone.iid).where(Zone.id == id) )

            Zone.delete().where(Zone.id == id).execute()

    except IntegrityError:
        return {"msg": "Error", "code":  220}, 400

    return {"msg": "ok" }, 200

addOrEditSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id" : {"type" : "integer"},
        "name" : {"type" : "string"},
        "zone_group" : {"type" : "integer"},
    },
    "required": ["name", "zone_group"]
}

# Format:
# { id: 1, (optional, if missing a new group will be created)
#   name: "name",
#   zone_group: 1
@bp.route("addoredit", methods=["POST"])
@utils.validateJSONInput(addOrEditSchema,isAdmin=True)
def addOrEdit():

    jsonData = flask.request.get_json()

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():

            updColumns = {
                Zone.name: jsonData['name'],
                Zone.zone_group: jsonData['zone_group'],
            }

            if 'id' in jsonData:

                rowCount = Zone.update(updColumns).where(Zone.id == jsonData['id']).execute()
                if rowCount != 1:
                    raise ApplyError("Wrong number of affected rows", 221)

            else:

                Zone.insert(updColumns).execute()


    except IntegrityError as err:
        return {"msg": "Error", "code": 222 }, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok" }, 200

membersSchema = addToTabulatorSchema({
    "properties": {
        "zid": {"type": "integer"},
    },
    "required": ["zid"]
})

@bp.route("members", methods=["POST"])
@utils.validateJSONInput(membersSchema,isAdmin=True)
def members():

    requestData = flask.request.get_json()
    zid = requestData['zid']

    query = ZoneAssign.select(Users.login, Users.name, ZoneAssign.zone_role, (Users.account_type >= ACCOUNT_TYPE_GROUP).alias("isGroup") ) \
                  .join(Users, on=(ZoneAssign.login == Users.login)) \
                  .where(ZoneAssign.zid == zid)

    (query, lastPage) = applyTabulatorToQuery(query,requestData)

    res = { "data": [ *query.iterator() ] }

    if lastPage is not None:
        res["last_page"] = lastPage

    return res

assignSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "zid": {"type": "integer"},
        "change": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "login" : {"type" : "string"},
                    "role" : {"enum" : [ZONE_ROLE_ADMIN,ZONE_ROLE_USER,ZONE_ROLE_VIEWER]}
                },
                "required": [ "login", "role"],
            },
        },
        "remove": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string" },
        },
    },
    "required": ['zid']
}

@bp.route("assign", methods=["POST"])
@utils.validateJSONInput(assignSchema,isAdmin=True)
def assign():

    jsonData = flask.request.get_json()

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():

            zid = jsonData['zid']

            if 'change' in jsonData:

                data = [
                    {
                        "zid": zid,
                        "login": i['login'],
                        "zone_role": i['role']
                    } for i in jsonData['change'] ]

                rowCount = ZoneAssign.insert(data) \
                                .on_conflict(
                                    conflict_target=[ZoneAssign.zid,ZoneAssign.login],
                                    update={ZoneAssign.zone_role: EXCLUDED.zone_role} ) \
                                .as_rowcount() \
                                .execute()

                if rowCount != len(jsonData['change']):
                    raise ApplyError("Wrong number of affected rows", 223)

            if 'remove' in jsonData:

                rowCount = ZoneAssign.delete() \
                                    .where( (ZoneAssign.zid == zid) & (ZoneAssign.login.in_(jsonData['remove'])) ) \
                                    .execute()

                if rowCount != len(jsonData['remove']):
                    raise ApplyError("Wrong number of affected rows", 224)


    except IntegrityError as err:
        return {"msg": "Error", "code": 225 }, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok" }, 200

# Format
#
# input is multipart/form-data
# optional key is image which should contain either JPEG or PNG
# obligatory key json should contain json of the following format:
# {
#   zid: 10
#   addOrUpdate: [
#       {name: "seat 1", x: 10, y: 10}
#       {name: "seat 2", x: 20, y: 20}
#       {sid: 20, name: "old seat 3", x: 20, y: 20}
#       {sid: 30, name: "old seat 4", x: 20, y: 20}
#   ],
#   remove: [ sid, sid, sid]
# }
@bp.route("modify", methods=["POST"])
def modify():

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 230 }, 403

    imageFile = flask.request.files.get('image', None)
    if imageFile is not None:

        mimeType = None
        allowedMagics = [
            # JPEG
            (b'\xFF\xD8\xFF\xDB', "image/jpeg"),
            (b'\xFF\xD8\xFF\xE0\x00\x10\x4A\x46\x49\x46\x00\x01', "image/jpeg"),
            (b'\xFF\xD8\xFF\xEE', "image/jpeg"),
            (b'\xFF\xD8\xFF\xE1', "image/jpeg"), # let's ignore the following part \x??\x??\x45\x78\x69\x66\x00\x00'
            # PNG
            (b'\x89\x50\x4E\x47\x0D\x0A\x1A\x0A', "image/png"),
        ]

        magic = imageFile.stream.read(12)
        for i in allowedMagics:
            if magic.startswith(i[0]):
                mimeType = i[1]
                break
        else:
            return {"msg": "Wrong file format", "code": 231 }, 400

        imageFile.stream.seek(0,os.SEEK_END)
        if imageFile.stream.tell() > flask.current_app.config['MAX_MAP_SIZE']:
            return {"msg": "Image too big", "code": 232 }, 400

        imageFile.stream.seek(0,os.SEEK_SET)

    jsonData = flask.request.form.get('json', None)

    jsonSchema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "zid": {"type": "integer"},
            "addOrUpdate": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "sid" : {"type" : "integer"},
                        "name" : {"type" : "string"},
                        "x" : {"type" : "integer"},
                        "y" : {"type" : "integer"},
                    },
                    "anyOf": [
                        {"required": ["sid"] },
                        {"required": ["name","x","y"] },
                    ],
                },
            },
            "remove": {
                "type": "array",
                "items": { "type": "integer" },
            },
        },
        "required": ['zid'],
        "additionalProperties": False
    }

    try:
        jsonData = orjson.loads(jsonData)
        validate(jsonData,jsonSchema)
    except orjson.JSONDecodeError:
        return {"msg": "Error in paring JSON", "code": 233 }, 400
    except ValidationError as err:
        return {"msg": "Data error", "code": 234 }, 400

    class ApplyError(Exception):
        pass

    zid = jsonData['zid']

    try:

        with DB.atomic():

            if imageFile is not None:

                blobId = Zone.select(Zone.iid) \
                            .where(Zone.id == zid) \
                            .scalar(as_tuple = True)

                if blobId is None:
                    raise ApplyError("Wrong zid", 235)

                blobId = blobId[0]
                newBlobId = blob_storage.addOrUpdateBlob(mimeType, imageFile.stream.read(), blobId)

                if newBlobId is None:
                    raise ApplyError("Blob not created", 236)

                if blobId != newBlobId:
                    Zone.update({Zone.iid: newBlobId}) \
                        .where(Zone.id == zid) \
                        .execute()

            if 'remove' in jsonData:

                rowCount = Seat.delete() \
                                .where( (Seat.id.in_(jsonData['remove'])) & (Seat.zid == zid) ) \
                                .execute()

                if rowCount != len(jsonData['remove']):
                    raise ApplyError("Wrong number of affected rows", 237)

            if 'addOrUpdate' in jsonData:

                columnsMap = {
                    'sid': Seat.id,
                    'name': Seat.name,
                    'x': Seat.x,
                    'y': Seat.y
                }

                dataInsert = []
                totalCount = 0
                for i in jsonData['addOrUpdate']:

                    entry = {}
                    for column,value in i.items():
                        if column in columnsMap:
                            entry[columnsMap[column]] = value

                    if Seat.id in entry:
                        sid = entry.pop(Seat.id)
                        rowCount = Seat.update(entry) \
                                        .where( (Seat.id == sid) & (Seat.zid == zid) )\
                                        .execute()
                        totalCount += rowCount
                    else:
                        entry[Seat.zid] = zid
                        dataInsert.append(entry)

                if len(dataInsert):
                    rowCount = Seat.insert(dataInsert).as_rowcount().execute()
                    totalCount += rowCount

                if totalCount != len(jsonData['addOrUpdate']):
                    raise ApplyError("Wrong number of affected rows", 238)

    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok"}, 200


@bp.route("getSeats/<int:zid>")
def getSeats(zid):

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 250 }, 403

    query = Seat.select(Seat.id, Seat.name, Seat.x, Seat.y) \
                .where(Seat.zid == zid)

    res = {
        str(i['id']): {
            "name": i['name'],
            "x": i['x'],
            "y": i['y']
            } for i in query.iterator()
    }

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')
