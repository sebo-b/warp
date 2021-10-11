import flask
from . import auth
from . import utils
from jsonschema import validate, ValidationError
import xlsxwriter
import orjson
import io
import peewee

from .db import *

bp = flask.Blueprint('xhr', __name__)

#Format JSON
#   zones: {
#       zidN: "Zone name" }
#   users: {
#       login: "name"
#   seats: {
#       sidN: {                     # FOR SEAT IN THE CURRENT ZONE
#          name: "name",
#          x: 10, y: 10,
#          zid: zid,
#          enabled: true|false,
#          book: [
#              { bid: 10, login: "sebo", fromTS: 1, toTS: 2 }
#          assignments: [ login1, login2, ... ]
#       sidM: {                     # FOR SEAT NOT IN THE CURRENT ZONE
#          name: "name",
#          zid: zid,
#          book: [
#              { bid: 10, fromTS: 1, toTS: 2 }
#
#  note that book array is sorted on fromTS
#
# this route accepts the following optional arguments:
#   login=string - sidM... will be for a given user (requires zoneAdmin)
#   onlyOtherZone=0|1 - returns only zones, users for other zones (sidM...)
@bp.route("/zone/getSeats/<zid>")
def zoneGetSeats(zid):

    res = {
        "seats": {}
    }

    if flask.g.isAdmin:
        zoneRole = ZONE_ROLE_ADMIN
    else:
        zoneRole = ZoneAssign.select(peewee.fn.MIN(ZoneAssign.zone_role)) \
                       .where((ZoneAssign.zid == zid) & (ZoneAssign.login.in_(flask.g.groups))) \
                       .group_by(ZoneAssign.zid).scalar()

    if ('login' in flask.request.args or 'onlyOtherZone' in flask.request.args) and zoneRole > ZONE_ROLE_ADMIN:
        return {"msg": "not allowed"}, 403

    tr = utils.getTimeRange()
    usedZones = set()
    usedUsers = set()

    if flask.request.args.get('onlyOtherZone') not in {'1','True','true'}:

        assignCursor = SeatAssign.select(SeatAssign.sid, Users.login) \
                                .join(Users,on=(SeatAssign.login == Users.login)) \
                                .join(Seat, on=(SeatAssign.sid == Seat.id)) \
                                .where(Seat.zid == zid)

        assignments = {}
        for r in assignCursor:

            if r['sid'] not in assignments:
                assignments[r['sid']] = set()

            assignments[r['sid']].add(r['login'])
            usedUsers.add(r['login'])

        seatsCursor = Seat.select(Seat.id, Seat.name, Seat.x, Seat.y, Seat.zid, Seat.enabled) \
                            .where(Seat.zid == zid)

        if zoneRole != ZONE_ROLE_ADMIN:
            seatsCursor = seatsCursor.where(Seat.enabled == True)

        for s in seatsCursor.iterator():

            seatD = {
                "name": s['name'],
                "x": s['x'],
                "y": s['y'],
                "zid": s['zid'],
                "enabled": s['enabled'] != 0,
                "book": []
            }

            if s['id'] in assignments:
                seatD['assignments'] = [*assignments[s['id']]]

            res['seats'][ str(s['id']) ] = seatD


        bookQuery = Book.select(Book.id, Book.login, Book.sid, Users.name.alias('username'), Book.fromts, Book.tots) \
                            .join(Users, on=(Book.login == Users.login)) \
                            .join(Seat, on=(Book.sid == Seat.id)) \
                            .where((Book.fromts < tr['toTS']) & (Book.tots > tr['fromTS']) & (Seat.zid == zid)) \
                            .order_by(Book.fromts)

        if zoneRole != ZONE_ROLE_ADMIN:
            bookQuery = bookQuery.where(Seat.enabled == True)

        for b in DB.execute(bookQuery):

            sid = str(b[2])

            res['seats'][sid]['book'].append({
                "bid": b[0],
                "login": b[1],
                "fromTS": b[4],
                "toTS": b[5] })

            usedUsers.add(b[1])

        usedZones.add(zid)

    login = flask.request.args.get('login')
    if login is None:
         login = flask.g.login
    else:
        isLoginInZone = ZoneAssign.select(SQL_ONE) \
                                .join(Groups, join_type=peewee.JOIN.LEFT_OUTER, on=(ZoneAssign.login == Groups.group)) \
                                .where(ZoneAssign.zid == zid) \
                                .where( (Groups.login == login) | (ZoneAssign.login == login)).first()

        if isLoginInZone is None:
            return {"msg": "not allowed"}, 403

    # User should get all his conflicting bookings even if he is not assigned to the zone
    # this is useful in case of reassignment
    # Also user is not allowed to book in not-assigned zones, but he/she is allowed to delete
    # own bookings from not-assigned zones
    otherZoneBookQuery = Book.select(Book.sid, Seat.name, Seat.zid, Book.id, Book.fromts, Book.tots) \
                            .join(Seat, on=(Book.sid == Seat.id)) \
                            .join(Zone, on=(Seat.zid == Zone.id)) \
                            .where( (Seat.zid != zid) & (Seat.enabled == True) ) \
                            .where(Zone.zone_group == ( \
                                Zone.select(Zone.zone_group).where(Zone.id == zid)) ) \
                            .where(Book.login == login) \
                            .order_by(Book.fromts).tuples()

    for b in otherZoneBookQuery.iterator():

        sid = str(b[0])

        if sid not in res['seats']:
            res['seats'][sid] = {
                "name": b[1],
                "zid": b[2],
                "book": []
            }
            usedZones.add(b[2])

        res['seats'][sid]['book'].append({
            "bid": b[3],
            "fromTS": b[4],
            "toTS": b[5]
            })

    usedZonesQuery = Zone.select(Zone.id,Zone.name).where(Zone.id.in_(usedZones)).tuples()
    res['zones'] = {str(i[0]): i[1] for i in usedZonesQuery.iterator()}

    usedUsersQuery = Users.select(Users.login, Users.name).where(Users.login.in_(usedUsers)).tuples()
    res['users'] = {str(i[0]): i[1] for i in usedUsersQuery.iterator()}

    resR = flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')

    return resR


# format:
# {
#   enable: [ sid, sid, ...],
#   disable: [ sid, sid, ...],
#   assign: {
#       sid: sid,
#       logins: [ login, login, ... ]
#   },
#   book: {
#       login: login,       #optional, requires ZONE_ROLE_ADMIN and login assigned to the zone
#       sid: sid,
#       dates: [
#           { fromTS: timestamp, toTS: timestamp },
#           { fromTS: timestamp, toTS: timestamp },
#       ]
#   },
#   remove: [ bid, bid, bid]
# }
@bp.route("/zone/apply", methods=["POST"])
def zoneApply():

    if not flask.request.is_json:
        flask.abort(404)

    apply_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {
            "enable": {
                "type": "array",
                "items": {
                    "type": "integer"
                },
            },
            "disable": {
                "type": "array",
                "items": {
                    "type": "integer"
                },
            },
            "assign": {
                "type": "object",
                "properties": {
                    "sid" : {"type" : "integer"},
                    "logins": {
                        "type": "array",
                        "items": {
                            "type": "string",
                        },
                    },
                },
            },
            "book": {
                "type": "object",
                "properties": {
                    "login": {"type": "string"},
                    "sid" : {"type" : "integer"},
                    "dates": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "fromTS": {"type" : "integer"},
                                "toTS": {"type" : "integer"}
                            },
                            "required": [ "fromTS", "toTS"]
                        }
                    }
                },
                "required": [ "sid", "dates"],
            },
            "remove": {
                "type": "array",
                "items": {
                    "type": "integer"
                }
            }
        },
        "anyOf": [
            {"required": [ "enable" ]},
            {"required": [ "disable" ]},
            {"required": [ "assign" ]},
            {"required": [ "book" ]},
            {"required": [ "remove" ]}
        ]
    }

    #Global admin doesn't have time restriction
    if not flask.g.isAdmin:
        ts = utils.getTimeRange()
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["fromTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["fromTS"]["maximum"] = ts["toTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["toTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["toTS"]["maximum"] = ts["toTS"]

    try:
        validate(apply_data,schema)
    except ValidationError as err:
        return {"msg": "invalid input" }, 400

    # -------------------------------------
    # PERMISSIONS CHECK
    # -------------------------------------
    if 'remove' in apply_data:

        # list non-owned bookings
        removeQ = Book.select(Book.id, Book.login, Seat.zid) \
                        .join(Seat, on=(Book.sid == Seat.id)) \
                        .where(Book.id.in_(apply_data['remove'])) \
                        .where(Book.login != flask.g.login)

        remove = [ i for i in removeQ.iterator() ]

        # check if current user is admin in the zones where bookings are made
        if len(remove):

            removeZones = [ i['zid'] for i in remove ]
            rolesQuery = ZoneAssign.select(ZoneAssign.zid, peewee.fn.MIN(ZoneAssign.zone_role).alias('zone_role') ) \
                                    .where(ZoneAssign.zid.in_(removeZones) ) \
                                    .where(ZoneAssign.login.in_(flask.g.groups)) \
                                    .group_by(ZoneAssign.zid)

            for rqI in rolesQuery.iterator():
                if rqI['zone_role'] <= ZONE_ROLE_ADMIN:
                    remove = [ i for i in remove if i['zid'] != rqI['zid']]

        if len(remove):
            return {"msg": "Forbidden", "code": 101 }, 403

    # zone access
    seatsReqZoneAdmin = []
    seatsReqZoneUser = []
    if 'enable' in apply_data: seatsReqZoneAdmin.extend(apply_data['enable'])
    if 'disable' in apply_data: seatsReqZoneAdmin.extend(apply_data['disable'])
    if 'assign' in apply_data: seatsReqZoneAdmin.append(apply_data['assign']['sid'])
    if 'book' in apply_data:
        if 'login' in apply_data['book']:
            seatsReqZoneAdmin.append(apply_data['book']['sid'])
        else:
            seatsReqZoneUser.append(apply_data['book']['sid'])

    if seatsReqZoneAdmin or seatsReqZoneUser:

        zoneAssignQuery = ZoneAssign.select(ZoneAssign.zid.alias('zid'), peewee.fn.MIN(ZoneAssign.zone_role).alias('zone_role') ) \
                                    .where(ZoneAssign.login.in_(flask.g.groups)) \
                                    .group_by(ZoneAssign.zid)

        rolesQuery = Seat.select( Seat.id, zoneAssignQuery.c.zone_role ) \
                        .join( zoneAssignQuery, join_type=peewee.JOIN.LEFT_OUTER,  on=(Seat.zid == zoneAssignQuery.c.zid) ) \
                        .where(Seat.id.in_(seatsReqZoneAdmin+seatsReqZoneUser)) \
                        .tuples()

        if len(rolesQuery) == 0:
            return {"msg": "Forbidden", "code": 102 }, 403

        for r in rolesQuery:
            if r[1] is None \
                or ( r[1] > ZONE_ROLE_USER and r[0] in seatsReqZoneUser ) \
                or ( r[1] > ZONE_ROLE_ADMIN and r[0] in seatsReqZoneAdmin ):
                return {"msg": "Forbidden", "code": 103 }, 403

    # if login is set in book, check if user is assigned to the zone
    if 'book' in apply_data and 'login' in apply_data['book']:
        login = apply_data['book']['login']
        sid = apply_data['book']['sid']

        isLoginInZone = Seat.select(SQL_ONE) \
                                .join(ZoneAssign, on=(Seat.zid == ZoneAssign.zid)) \
                                .join(Groups, join_type=peewee.JOIN.LEFT_OUTER, on=(ZoneAssign.login == Groups.group)) \
                                .where(Seat.id == sid) \
                                .where( (Groups.login == login) | (ZoneAssign.login == login)).first()

        if isLoginInZone is None:
            return {"msg": "Forbidden", "code": 104}, 403

    if 'book' in apply_data:

        sid = apply_data['book']['sid']

        # check if seat is enabled
        enabled = Seat.select(SQL_ONE).where((Seat.id == sid) & (Seat.enabled == True)).scalar()
        if enabled is None:
            return {"msg": "Forbidden", "code": 105}, 403

        # check if user is assigned to the seat
        login = apply_data['book'].get('login', flask.g.login)
        assignedQ = SeatAssign.select(SQL_ONE).where(SeatAssign.sid == sid)
        assignedToMeQ = assignedQ.where(SeatAssign.login == login)

        if (assignedQ.scalar() is not None and assignedToMeQ.scalar() is None):
            return {"msg": "Forbidden", "code": 106}, 403

    # -------------------------------------
    # CALCULATE CONFLICTS
    # -------------------------------------
    ts = utils.getTimeRange(True)

    conflicts_in_disable = None
    if 'disable' in apply_data:

        query = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                    .join(Users, on=(Book.login == Users.login)) \
                    .where((Book.fromts < ts['toTS']) & (Book.tots > ts['fromTS'])) \
                    .where(Book.sid.in_(apply_data['disable']))

        conflicts_in_disable = [
            {
                "sid": row['sid'],
                "fromTS": row['fromts'],
                "toTS": row['tots'],
                "login": row['login'],
                "username": row['name']
            } for row in query
        ]

    conflicts_in_assign = None
    if 'assign' in apply_data:

        query = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                    .join(Users, on=(Book.login == Users.login)) \
                    .where((Book.fromts < ts['toTS']) & (Book.tots > ts['fromTS'])) \
                    .where(Book.sid == apply_data['assign']['sid']) \
                    .where(Users.login.not_in(apply_data['assign']['logins']))

        conflicts_in_assign = [
            {"sid": row['sid'],
                "fromTS": row['fromts'],
                "toTS": row['tots'],
                "login": row['login'],
                "username": row['name']} for row in query]

    # -------------------------------------
    # APPLY CHANGES
    # -------------------------------------

    class ApplyError(Exception):
        pass

    try:

        with DB.atomic():

            if 'enable' in apply_data:

                Seat.update({Seat.enabled: True}).where(Seat.id.in_(apply_data['enable'])).execute()

            if 'disable' in apply_data:

                Seat.update({Seat.enabled: False}).where(Seat.id.in_(apply_data['disable'])).execute()

            if 'assign' in apply_data:

                SeatAssign.delete().where(SeatAssign.sid == apply_data['assign']['sid']).execute()

                if len(apply_data['assign']['logins']):

                    insertData = [{
                        SeatAssign.sid: apply_data['assign']['sid'],
                        SeatAssign.login: l
                        } for l in apply_data['assign']['logins']]

                    rowCount = SeatAssign.insert(insertData).execute()

                    if rowCount != len(apply_data['assign']['logins']):
                        raise ApplyError("Number of affected row is different then in assign.logins.", 107)

            # remove must be executed before book
            if 'remove' in apply_data:

                stmt = Book.delete().where(Book.id.in_(apply_data['remove']))
                rowCount = stmt.execute()

                if rowCount != len(apply_data['remove']):
                    raise ApplyError("Number of affected row is different then in remove.",108)

            # then we create new reservations
            if 'book' in apply_data:

                sid = apply_data['book']['sid']
                login = apply_data['book'].get('login', flask.g.login)

#                THIS IS DONE IN A TRIGGER - so it is atomic without using higer isolation level
#                # check if there is overlap in booking
#                zoneGroupQ = Seat.select(Zone.zone_group) \
#                                .join(Zone, on=(Seat.zid == Zone.id)) \
#                                .where(Seat.id == sid)
#
#                minFromTS = reduce(lambda a,b: a if a['fromTS'] < b['fromTS'] else b, apply_data['book']['dates'])['fromTS']
#                maxToTS = reduce(lambda a,b: a if a['toTS'] > b['toTS'] else b, apply_data['book']['dates'])['toTS']
#                overlapsQ = Book.select(Book.sid, Book.fromts.alias('fromTS'), Book.tots.alias('toTS')) \
#                               .join(Seat, on=(Book.sid == Seat.id)) \
#                               .join(Zone, on=(Seat.zid == Zone.id)) \
#                               .where( Zone.zone_group == zoneGroupQ) \
#                               .where((Book.sid == sid) | (Book.login == login)) \
#                               .where((Book.fromts < maxToTS) & (Book.tots > minFromTS)) \
#                               .order_by(Book.fromts)
#
#                dates = apply_data['book']['dates']
#                dates.sort(key=lambda a: a['fromTS'])
#
#                last = {'fromTS': 0, 'toTS':  0 }
#                for i in heapq.merge(dates,overlapsQ.iterator(), key=lambda a: a['fromTS']):
#                    if i['fromTS'] <= last['toTS'] and i['toTS'] > last['fromTS']:
#                        raise ApplyError("Overlap.",109)
#                    last = i

                insertData = [ {
                        Book.login: login,
                        Book.sid: sid,
                        Book.fromts: x['fromTS'],
                        Book.tots: x['toTS']
                    } for x in apply_data['book']['dates'] ]

                stmt = Book.insert(insertData)

                try:
                    stmt.execute()
                except peewee.IntegrityError:
                    raise ApplyError("Overlapping time",109)


    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    ret = { "msg": "ok" }

    if conflicts_in_disable:
        ret["conflicts_in_disable"] = conflicts_in_disable

    if conflicts_in_assign:
        ret["conflicts_in_assign"] = conflicts_in_assign

    return ret, 200


#Format
# {
#   data: {
#         login1: { name: "User 1", role: 1 }
#         login2: { name: "User 2", role: 2 }
#         ...
#       },
#   login: user1
#   real_login: user2
#   role: 2
# }
@bp.route("/zone/getUsers/<zid>")
def zoneGetUsers(zid):

    if not flask.g.isAdmin:
        zoneRole = ZoneAssign.select(peewee.fn.MIN(ZoneAssign.zone_role)) \
                       .where((ZoneAssign.zid == zid) & (ZoneAssign.login.in_(flask.g.groups))) \
                       .group_by(ZoneAssign.zid).scalar()
        if zoneRole > ZONE_ROLE_ADMIN:
            flask.abort(403)


    zoneUsers = ZoneAssign.select( \
            peewee.Case(Groups.login.is_null(), ((True, ZoneAssign.login),), Groups.login).distinct() ) \
        .where(ZoneAssign.zid == zid) \
        .join(Groups, join_type=peewee.JOIN.LEFT_OUTER, on=(ZoneAssign.login == Groups.group)).tuples()

    usersQuery = Users.select(Users.login, Users.name) \
                       .where(Users.login.in_(zoneUsers)).tuples()

    res = { i[0]: i[1] for i in usersQuery.iterator() }

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')

##
# Format:
# { login: login, name: name, role: role, password: plain_text, action: "add|update|delete" }
# return array (now of length 1) of updated/created row
@bp.route("/api/editUser", methods=["POST"])
def editUser():

    from werkzeug.security import generate_password_hash

    if not flask.request.is_json:
        flask.abort(404)

    role = flask.session.get('role')

    if role > auth.ROLE_MANAGER:
        flask.abort(403)

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "login" : {"type" : "string"},
            "name" : {"type" : "string"},
            "role" : {"type" : "integer", "minimum": role },
            "password" : {"type" : "string"},
            "action": {"enum": ["add", "delete","update"]}
        },
        "allOf": [
            {
                "required": [ "login", "action"]
            },
            {
                "if": {
                    "properties": {
                        "action": {
                            "enum": ["add","update"]
                        }
                    }
                },
                "then": {
                    "required": [ "name", "role" ]
                }
            },
            {
                "if": {
                    "properties": {
                        "action": {
                            "const": "add"
                        }
                    }
                },
                "then": {
                    "required": [ "password" ]
                }
            }
        ]
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "Data error" }, 400

    class WarpErr(Exception):
        pass

    try:

        with DB.atomic():

            passHash = None
            if 'password' in action_data and len(action_data['password']) > 0:
                passHash = generate_password_hash(action_data['password'])

            if action_data['action'] == "update":

                if action_data['role'] < role:
                    raise WarpErr('Cannot set higher role than yours')

                updColumns = {
                    Users.name: action_data['name'],
                    Users.role: action_data['role'],
                }

                if passHash:
                    updColumns[Users.password] = passHash

                rowCount = Users.update(updColumns) \
                                .where((Users.login == action_data['login']) & (Users.role >= role)) \
                                .execute()

                if rowCount != 1:
                    raise WarpErr("Wrong number of affected rows")

            elif action_data['action'] == "add":

                if action_data['role'] < role:
                    raise WarpErr('Cannot add user with higher role than yours')

                Users.insert({
                    Users.login: action_data['login'],
                    Users.name: action_data['name'],
                    Users.role: action_data['role'],
                    Users.password: passHash
                }).execute()

            elif action_data['action'] == "delete":

                rowCount = Users.delete() \
                                .where((Users.login == action_data['login']) & (Users.role >= role)) \
                                .execute()

                if rowCount != 1:
                    raise WarpErr("Wrong number of affected rows")

    except IntegrityError as err:
        if action_data['action'] == "delete":
            return {"msg": "User cannot be deleted" }, 400
        elif action_data['action'] == "add":
            return {"msg": "Login exits" }, 400
        else:
            return {"msg": "Error" }, 400
    except WarpErr as err:
        return {"msg": "Error" }, 400

    query = Users.select(Users.login, Users.name, Users.role).where(Users.login == action_data['login'])

    if len(query) == 0:
        return flask.jsonify([{"login": action_data['login']}])
    else:
        return flask.jsonify([{
            "login": query[0]['login'],
            "name": query[0]['name'],
            "role": query[0]['role']
            }])


# Format
@bp.route("/bookings/get")
def bookingsGet():

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    tr = utils.getTimeRange()

    cursor = Book.select(Book.id, Book.uid, Users.name.alias('user_name'), Users.login, Zone.name.alias('zone_name'), Seat.name.alias('seat_name'), Book.fromts, Book.tots) \
                 .join(Seat, on=(Book.sid == Seat.id)) \
                 .join(Zone, on=(Seat.zid == Zone.id)) \
                 .join(Users, on=(Book.uid == Users.id)) \
                 .where((Book.fromts < tr["toTS"]) & (Book.tots > tr["fromTS"]))

    res = []

    for row in cursor:

        if role >= auth.ROLE_VIEVER:
            can_edit = False
        elif role <= auth.ROLE_MANAGER:
            can_edit = True
        else:
            can_edit = row['uid'] == uid

        res.append({
            "bid": row["id"],
            "user_name": row["user_name"]+" ["+row["login"]+"]" if role <= auth.ROLE_MANAGER else row["user_name"],
            "zone_name": row["zone_name"],
            "seat_name": row["seat_name"],
            "fromTS": row["fromts"],
            "toTS": row["tots"],
            "can_edit": can_edit
        })

    return flask.jsonify(res)



@bp.route("/bookings/report", methods=["POST"])
def bookingsReport():

    if not flask.request.is_json:
        flask.abort(404)

    if not flask.g.isAdmin:
        flask.abort(403)

    requestData = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "page" : {"type" : "integer"},
            "size" : {"type" : "integer"},
            "export": {"enum": ["xlsx"] },
            "sorters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field" : {"type" : "string"},
                        "dir" : {"enum" : ["asc", "desc"] }
                    },
                    "required": [ "field", "dir"],
                },
            },
            "filters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field" : {"type" : "string"},
                        "type" : {"enum" : ["starts", ">=","<="] }
                    },
                    "required": [ "field", "type", "value"],
                    "if": {
                        "properties": { "type" : {"enum" : ["starts"] } }
                    },
                    "then": {
                        "properties": { "value" : {"type" : "string" } }
                    },
                    "else": {
                        "properties": { "page" : {"type" : "integer" } }
                    },
                },
            },
        },
        "dependencies": {
            "page": ["size"]
        }
    }

    try:
        validate(requestData,schema)
    except ValidationError as err:
        return {"msg": "Data error" }, 400

    columnsMap = {
        "id": Book.id,
        "user_name": Users.name,
        "login": Users.login,
        "zone_name": Zone.name,
        "seat_name": Seat.name,
        "fromTS": Book.fromts,
        "toTS": Book.tots
    }

    query = Book.select(Book.id, Users.name.alias('user_name'), Users.login, Zone.name.alias('zone_name'), Seat.name.alias('seat_name'), Book.fromts, Book.tots) \
                      .join(Seat, on=(Book.sid == Seat.id)) \
                      .join(Zone, on=(Seat.zid == Zone.id)) \
                      .join(Users, on=(Book.login == Users.login))

    if "filters" in requestData:
        for i in requestData['filters']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] == '<=':
                    query = query.where( field <= i["value"])
                elif i['type'] == '>=':
                    query = query.where( field >= i["value"])
                elif i['type'] == 'starts':
                    query = query.where( field.startswith(i["value"]))

    lastPage = None
    if "size" in requestData:

        limit = requestData['size']

        if "page" in requestData:

            countCursor = query.columns(COUNT_STAR.alias('count'))
            count = countCursor[0]['count']

            lastPage = -(-count // limit)   # round up

            offset = (requestData['page']-1)*requestData['size']
            query = query.offset(offset)

        query = query.limit(limit)

    if "sorters" in requestData:
        for i in requestData['sorters']:
            if i["field"] in columnsMap:
                query = query.order_by_extend( columnsMap[i["field"]].asc() if i["dir"] == "asc" else columnsMap[i["field"]].desc() )


    if "export" in requestData:
        # only xlsx for now

        memoryBuffer = io.BytesIO()

        workbook = xlsxwriter.Workbook(memoryBuffer, {'in_memory': True})
        worksheet = workbook.add_worksheet()

        columnsHeader = [ "User name", "Login", "Zone name", "Seat name", "From", "To" ]
        columnsContent = [ "user_name", "login", "zone_name", "seat_name", "fromts", "tots" ]

        worksheet.write_row(0,0,columnsHeader)

        for rowNo,dbRow in enumerate(query,1):

            rowData = []
            for i in columnsContent:
                if i[-2:] == "ts":
                    rowData.append( (dbRow[i] / 86400)+25569 )
                else:
                    rowData.append(dbRow[i])

            worksheet.write_row(rowNo,0,rowData)

        dateFormat = workbook.add_format({'num_format': 'yyyy-mm-dd hh:mm'})
        for colNo, col in enumerate(columnsContent):
            if col[-2:] == "ts":
                worksheet.set_column(colNo, colNo, None, dateFormat)

        workbook.close()

        memoryBuffer.seek(0)

        return flask.send_file(
            memoryBuffer,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            download_name="warp_export.xlsx"
        )

    else:

        res = {
            "data":[]
        }

        if lastPage is not None:
            res["last_page"] = lastPage

        for row in query:

            res['data'].append({
                "id": row["id"],
                "user_name": row["user_name"],
                "login": row["login"],
                "zone_name": row["zone_name"],
                "seat_name": row["seat_name"],
                "fromTS": row["fromts"],
                "toTS": row["tots"]
            })

        return flask.jsonify(res)