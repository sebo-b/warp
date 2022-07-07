from collections import defaultdict
import flask
from jsonschema import validate, ValidationError
import orjson
import peewee

from warp import auth
from warp import utils
from warp.db import *

bp = flask.Blueprint('zone', __name__, url_prefix='zone')

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
@bp.route("getSeats/<int:zid>")
def getSeats(zid):

    res = {
        "seats": {}
    }

    zoneRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                              .where( (UserToZoneRoles.zid == zid) & (UserToZoneRoles.login == flask.g.login) ) \
                              .scalar()

    if zoneRole is None:
        return {"msg": "Forbidden", "code": 130 }, 403

    if ('login' in flask.request.args or 'onlyOtherZone' in flask.request.args):

        if zoneRole > ZONE_ROLE_ADMIN:
            return {"msg": "Forbidden", "code": 131 }, 403

        isLoginInZone = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                              .where(UserToZoneRoles.zid == zid) \
                              .where(UserToZoneRoles.login == flask.request.args.get('login') ) \
                              .scalar()

        if isLoginInZone is None:
            return {"msg": "Forbidden", "code": 132 }, 403

    tr = utils.getTimeRange()
    usedZones = set()
    usedUsers = set()

    if flask.request.args.get('onlyOtherZone') not in {'1','True','true'}:

        assignCursor = SeatAssign.select(SeatAssign.sid, Users.login) \
                                .join(Users,on=(SeatAssign.login == Users.login)) \
                                .join(Seat, on=(SeatAssign.sid == Seat.id)) \
                                .where(Seat.zid == zid)

        assignments = defaultdict(set)
        for r in assignCursor:
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

    login = flask.request.args.get('login',flask.g.login)

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


applySchema = {
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
@bp.route("apply", methods=["POST"])
@utils.validateJSONInput(applySchema)
def apply():

    apply_data = flask.request.get_json()
    ts = utils.getTimeRange()

    # -------------------------------------
    # PERMISSIONS CHECK
    # -------------------------------------

    # zone access
    seatsReqZoneAdmin = set()
    if 'enable' in apply_data: seatsReqZoneAdmin.update(apply_data['enable'])
    if 'disable' in apply_data: seatsReqZoneAdmin.update(apply_data['disable'])
    if 'assign' in apply_data: seatsReqZoneAdmin.add(apply_data['assign']['sid'])
    if 'book' in apply_data and 'login' in apply_data['book']: seatsReqZoneAdmin.add(apply_data['book']['sid'])

    if 'remove' in apply_data:

        # list non-owned bookings
        # user is always allowed to remove own bookings, even if is not assigned to the zone (or is just a viewer)
        # this hole allows user to update booking into allowed zone in case there is some left-over booking in another zone
        removeQ = Book.select(Book.sid) \
                      .where(Book.id.in_(apply_data['remove'])) \
                      .where(Book.login != flask.g.login).tuples()

        seatsReqZoneAdmin.update( [ i[0] for i in removeQ.iterator() ] )

    if seatsReqZoneAdmin:

        count = Seat.select(COUNT_STAR) \
                    .join(UserToZoneRoles, on=(Seat.zid == UserToZoneRoles.zid)) \
                    .where(UserToZoneRoles.login == flask.g.login) \
                    .where(Seat.id.in_(seatsReqZoneAdmin)) \
                    .where(UserToZoneRoles.zone_role <= ZONE_ROLE_ADMIN) \
                    .scalar()

        if count != len(seatsReqZoneAdmin):
            return {"msg": "Forbidden", "code": 102 }, 403

    if 'book' in apply_data:

        if not flask.g.isAdmin:     # TODO: should admin be allowed to do that?
            for b in apply_data['book']['dates']:
                if b['fromTS'] < ts["fromTS"] or b['fromTS'] > ts["toTS"] \
                    or b['toTS'] < ts["fromTS"] or b['toTS'] > ts["toTS"]:
                    return {"msg": "Forbidden", "code": 103}, 403

        sid = apply_data['book']['sid']
        login = apply_data['book'].get('login', flask.g.login)

        seat = Seat.select(Seat.enabled) \
                    .join(UserToZoneRoles, on=(Seat.zid == UserToZoneRoles.zid)) \
                    .where( (Seat.id == sid) & (UserToZoneRoles.login == login)) \
                    .first()

        # login not in the zone
        if seat is None:
            return {"msg": "Forbidden", "code": 104}, 403

        # seat is disabled
        if not seat['enabled']:
            return {"msg": "Forbidden", "code": 105}, 403

        # check if user is assigned to the seat
        assignedQ = SeatAssign.select(SQL_ONE).where(SeatAssign.sid == sid)
        assignedToMeQ = assignedQ.where(SeatAssign.login == login)

        if (assignedQ.scalar() is not None and assignedToMeQ.scalar() is None):
            return {"msg": "Forbidden", "code": 106}, 403

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

                    rowCount = SeatAssign.insert(insertData).as_rowcount().execute()

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


    # -------------------------------------
    # CALCULATE CONFLICTS
    # -------------------------------------
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

        if conflicts_in_disable:
            ret["conflicts_in_disable"] = conflicts_in_disable

    if 'assign' in apply_data and len(apply_data['assign']['logins']) > 0:

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
@bp.route("getUsers/<zid>")
def getUsers(zid):

    zoneUsers = UserToZoneRoles.select(Users.login, Users.name, UserToZoneRoles.zone_role) \
                               .join(Users, on=(UserToZoneRoles.login == Users.login) ) \
                               .where(UserToZoneRoles.zid == zid)

    res = {}

    for u in zoneUsers.iterator():

        if u['login'] == flask.g.login:
            if u['zone_role'] > ZONE_ROLE_ADMIN:
                return {"msg": "Forbidden", "code": 120 }, 403

        res[ u['login'] ] = u['name']

    if flask.g.login not in res:
        return {"msg": "Forbidden", "code": 121 }, 403

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')
