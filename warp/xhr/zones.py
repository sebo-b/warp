import flask
from peewee import JOIN, fn, EXCLUDED
from jsonschema import validate, ValidationError

from warp.db import *
from warp import utils
from warp.utils_tabulator import *

bp = flask.Blueprint('zones', __name__, url_prefix='zones')

# UNGROUPED_FILTER_KEY is defined in warp.db (single source of truth) and
# imported via `from warp.db import *`.


@bp.route("list", endpoint='list', methods=["POST"])
@utils.validateJSONInput(tabulatorSchema, isAdmin=True)
def listW():
    requestData = flask.request.get_json()

    countQuery = UserToZoneRoles.select(
        UserToZoneRoles.zid,
        COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_ADMIN).alias("admins"),
        COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_USER).alias("users"),
        COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_VIEWER).alias("viewers")) \
        .group_by(UserToZoneRoles.zid)

    seatCountSub = Seat.select(fn.COUNT(SQL_ONE)).where(Seat.zid == Zone.id)

    query = Zone.select(
        Zone.id, Zone.name, Zone.zone_type, Zone.zone_group,
        fn.COALESCE(countQuery.c.admins, 0).alias('admins'),
        fn.COALESCE(countQuery.c.users, 0).alias('users'),
        fn.COALESCE(countQuery.c.viewers, 0).alias('viewers'),
        fn.COALESCE(seatCountSub, 0).alias('seat_count')) \
        .join(countQuery, join_type=JOIN.LEFT_OUTER, on=(Zone.id == countQuery.c.zid))

    # The generic tabulator filter only does value comparisons; intercept the
    # "ungrouped" sentinel and translate it to an IS NULL predicate.
    if 'filter' in requestData:
        kept = []
        for f in requestData['filter']:
            if f.get('field') == 'zone_group' and f.get('value') == UNGROUPED_FILTER_KEY:
                query = query.where(Zone.zone_group.is_null())
            else:
                kept.append(f)
        requestData['filter'] = kept

    (query, lastPage) = applyTabulatorToQuery(query, requestData)

    res = {"data": [*query.iterator()]}
    if lastPage is not None:
        res["last_page"] = lastPage
    return res, 200


@bp.route("groups", endpoint='groups', methods=["GET"])
def groupsList():
    """Distinct, non-NULL zone group names (sorted) for the autocomplete."""
    if not flask.g.isAdmin:
        flask.abort(403)
    rows = Zone.select(Zone.zone_group) \
               .where(Zone.zone_group.is_null(False)) \
               .distinct() \
               .order_by(Zone.zone_group)
    return flask.jsonify([r['zone_group'] for r in rows.iterator()])


@bp.route("names", endpoint='names', methods=["GET"])
def zoneNames():
    """Distinct zone names (sorted) for the plans zone filter dropdown."""
    if not flask.g.isAdmin:
        flask.abort(403)
    rows = Zone.select(Zone.name).order_by(Zone.name)
    return flask.jsonify([r['name'] for r in rows.iterator()])


@bp.route("info/<int:zid>", endpoint='info', methods=["GET"])
def info(zid):
    """{id, name} for a single zone — the SPA's replacement for the server-side
    zone-name lookup view.zoneAssign used to do before the refactor (the client
    renders the assign view and calls this for the title)."""
    if not flask.g.isAdmin:
        flask.abort(403)
    zone = Zone.select(Zone.id, Zone.name).where(Zone.id == zid).first()
    if zone is None:
        flask.abort(404)
    return {"id": zone['id'], "name": zone['name']}


deleteSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id": {"type": "integer"},
        "reassign_zid": {"type": "integer"},
        "delete_seats": {"type": "boolean"},
    },
    "required": ["id"]
}


@bp.route("delete", methods=["POST"])
@utils.validateJSONInput(deleteSchema, isAdmin=True)
def delete():
    jsonData = flask.request.get_json()
    id = jsonData['id']

    # If the zone has seats, the client must provide either reassign_zid or delete_seats
    seat_count = Seat.select(COUNT_STAR).where(Seat.zid == id).scalar()
    if seat_count and seat_count > 0:
        reassign_zid = jsonData.get('reassign_zid')
        delete_seats = jsonData.get('delete_seats')

        if not reassign_zid and not delete_seats:
            # Return list of other zones for the modal
            other_zones = Zone.select(Zone.id, Zone.name)\
                .where(Zone.id != id)\
                .order_by(Zone.name)
            return {
                "msg": "Zone has seats",
                "code": 230,
                "seat_count": seat_count,
                "other_zones": [{'id': z['id'], 'name': z['name']} for z in other_zones]
            }, 409

        try:
            with DB.atomic():
                if reassign_zid:
                    # Verify target zone exists
                    target = Zone.select(SQL_ONE).where(Zone.id == reassign_zid).scalar()
                    if not target:
                        return {"msg": "Target zone not found", "code": 231}, 400
                    Seat.update({Seat.zid: reassign_zid}).where(Seat.zid == id).execute()
                elif delete_seats:
                    # Delete all bookings and seats in this zone
                    # Seats cascade-delete bookings, so we just delete seats
                    Seat.delete().where(Seat.zid == id).execute()

                Zone.delete().where(Zone.id == id).execute()
        except IntegrityError:
            return {"msg": "Error", "code": 220}, 400

        return {"msg": "ok"}, 200

    try:
        with DB.atomic():
            Zone.delete().where(Zone.id == id).execute()
    except IntegrityError:
        return {"msg": "Error", "code": 220}, 400

    return {"msg": "ok"}, 200


addOrEditSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id": {"type": "integer"},
        "name": {"type": "string"},
        "zone_type": {"type": "integer", "enum": [ZONE_TYPE_DISABLED, ZONE_TYPE_ENABLED, ZONE_TYPE_PUBLIC_VIEW, ZONE_TYPE_PUBLIC_BOOK]},
        "zone_group": {"type": ["string", "null"]},
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
                Zone.name: jsonData['name'],
            }
            if 'zone_type' in jsonData:
                updColumns[Zone.zone_type] = jsonData['zone_type']
            if 'zone_group' in jsonData:
                # treat empty string as NULL
                updColumns[Zone.zone_group] = jsonData['zone_group'] or None

            if 'id' in jsonData:
                rowCount = Zone.update(updColumns).where(Zone.id == jsonData['id']).execute()
                if rowCount != 1:
                    raise ApplyError("Wrong number of affected rows", 221)
            else:
                updColumns.setdefault(Zone.zone_type, ZONE_TYPE_DISABLED)
                Zone.insert(updColumns).execute()

    except IntegrityError:
        return {"msg": "Error", "code": 222}, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1]}, 400

    return {"msg": "ok"}, 200


membersSchema = addToTabulatorSchema({
    "properties": {
        "zid": {"type": "integer"},
    },
    "required": ["zid"]
})


@bp.route("members", methods=["POST"])
@utils.validateJSONInput(membersSchema, isAdmin=True)
def members():
    requestData = flask.request.get_json()
    zid = requestData['zid']

    query = ZoneAssign.select(Users.login, Users.name, ZoneAssign.zone_role, (Users.account_type >= ACCOUNT_TYPE_GROUP).alias("isGroup")) \
        .join(Users, on=(ZoneAssign.login == Users.login)) \
        .where(ZoneAssign.zid == zid)

    (query, lastPage) = applyTabulatorToQuery(query, requestData)

    res = {"data": [*query.iterator()]}
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
                    "login": {"type": "string"},
                    "role": {"enum": [ZONE_ROLE_ADMIN, ZONE_ROLE_USER, ZONE_ROLE_VIEWER]}
                },
                "required": ["login", "role"],
            },
        },
        "remove": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string"},
        },
    },
    "required": ['zid']
}


@bp.route("assign", methods=["POST"])
@utils.validateJSONInput(assignSchema, isAdmin=True)
def assign():
    jsonData = flask.request.get_json()

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():
            zid = jsonData['zid']

            if 'change' in jsonData:
                data = [
                    {"zid": zid, "login": i['login'], "zone_role": i['role']}
                    for i in jsonData['change']
                ]
                rowCount = ZoneAssign.insert(data) \
                    .on_conflict(
                        conflict_target=[ZoneAssign.zid, ZoneAssign.login],
                        update={ZoneAssign.zone_role: EXCLUDED.zone_role}) \
                    .as_rowcount() \
                    .execute()
                if rowCount != len(jsonData['change']):
                    raise ApplyError("Wrong number of affected rows", 223)

            if 'remove' in jsonData:
                rowCount = ZoneAssign.delete() \
                    .where((ZoneAssign.zid == zid) & (ZoneAssign.login.in_(jsonData['remove']))) \
                    .execute()
                if rowCount != len(jsonData['remove']):
                    raise ApplyError("Wrong number of affected rows", 224)

    except IntegrityError:
        return {"msg": "Error", "code": 225}, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1]}, 400

    return {"msg": "ok"}, 200
