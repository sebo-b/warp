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
#          assignments: [ { login: login|null, days_in_advance: N|null, isEveryone: true? }, ... ]
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

    zone = Zone.select(Zone.zone_type).where(Zone.id == zid).first()
    if zone is None:
        return {"msg": "Forbidden", "code": 130}, 403

    zone_type = zone['zone_type']
    specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                  .where((UserToZoneRoles.zid == zid) & (UserToZoneRoles.login == flask.g.login)) \
                                  .scalar()

    zoneRole = effectiveZoneRole(zone_type, specificRole)
    if zoneRole is None:
        return {"msg": "Forbidden", "code": 130}, 403

    if ('login' in flask.request.args or 'onlyOtherZone' in flask.request.args):

        if zoneRole > ZONE_ROLE_ADMIN:
            return {"msg": "Forbidden", "code": 131 }, 403

        targetLogin = flask.request.args.get('login')
        if zone_type in (ZONE_TYPE_PUBLIC_VIEW, ZONE_TYPE_PUBLIC_BOOK):
            if targetLogin is not None:
                userExists = Users.select(SQL_ONE).where(Users.login == targetLogin).scalar()
                if userExists is None:
                    return {"msg": "Forbidden", "code": 132}, 403
        else:
            isLoginInZone = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                  .where(UserToZoneRoles.zid == zid) \
                                  .where(UserToZoneRoles.login == targetLogin) \
                                  .scalar()
            if isLoginInZone is None:
                return {"msg": "Forbidden", "code": 132 }, 403

    tr = utils.getTimeRange()
    usedZones = set()
    usedUsers = set()

    if flask.request.args.get('onlyOtherZone') not in {'1','True','true'}:

        assignCursor = SeatAssign.select(SeatAssign.sid, SeatAssign.login, SeatAssign.days_in_advance) \
                                .join(Seat, on=(SeatAssign.sid == Seat.id)) \
                                .where(Seat.zid == zid)

        assignments = defaultdict(list)
        for r in assignCursor:
            entry = {'login': r['login'], 'days_in_advance': r['days_in_advance']}
            if r['login'] is None:
                entry['isEveryone'] = True
            else:
                usedUsers.add(r['login'])
            assignments[r['sid']].append(entry)

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
                        "type": "object",
                        "properties": {
                            "login": {"type": ["string", "null"]},
                            "days_in_advance": {"type": ["integer", "null"], "minimum": 0}
                        },
                        "required": ["login"]
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
#       logins: [ { login: login|null, days_in_advance: N|null }, ... ]
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

    if 'assign' in apply_data:
        # Enforce at most one null-login (everyone) row per seat
        null_count = sum(1 for l in apply_data['assign']['logins'] if l.get('login') is None)
        if null_count > 1:
            return {"msg": "At most one 'everyone' assignment allowed per seat", "code": 111}, 400

    if 'book' in apply_data:

        if not flask.g.isAdmin:     # TODO: should admin be allowed to do that?
            for b in apply_data['book']['dates']:
                if b['fromTS'] < ts["fromTS"] or b['fromTS'] > ts["toTS"] \
                    or b['toTS'] < ts["fromTS"] or b['toTS'] > ts["toTS"]:
                    return {"msg": "Forbidden", "code": 103}, 403

        sid = apply_data['book']['sid']
        login = apply_data['book'].get('login', flask.g.login)

        # Check seat exists and get zone type
        seatZone = Seat.select(Seat.enabled, Seat.zid, Zone.zone_type.alias('zone_type')) \
                       .join(Zone, on=(Seat.zid == Zone.id)) \
                       .where(Seat.id == sid) \
                       .first()

        if seatZone is None:
            return {"msg": "Forbidden", "code": 104}, 403

        # Effective zone role determines whether `login` can book here.
        # PUBLIC_VIEW users without an explicit USER+ role get VIEWER and are rejected.
        # DISABLED zones only allow ZONE_ROLE_ADMIN.
        bookerRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                    .where((UserToZoneRoles.zid == seatZone['zid']) & (UserToZoneRoles.login == login)) \
                                    .scalar()

        effectiveRole = effectiveZoneRole(seatZone['zone_type'], bookerRole)
        if effectiveRole is None or effectiveRole > ZONE_ROLE_USER:
            return {"msg": "Forbidden", "code": 104}, 403

        # seat is disabled
        if not seatZone['enabled']:
            return {"msg": "Forbidden", "code": 105}, 403

        # check if user is assigned to the seat and compute most-permissive days_in_advance
        assignedQ = SeatAssign.select(SQL_ONE).where(SeatAssign.sid == sid)

        if assignedQ.scalar() is not None:

            myAssignments = list(SeatAssign.select(SeatAssign.days_in_advance) \
                                           .where((SeatAssign.sid == sid) &
                                                  ((SeatAssign.login == login) | SeatAssign.login.is_null())) \
                                           .iterator())

            if not myAssignments:
                return {"msg": "Forbidden", "code": 106}, 403

            # NULL means MAX (full window); pick most permissive across all matching assignments
            best_days = None
            for a in myAssignments:
                if a['days_in_advance'] is None:
                    best_days = None
                    break
                if best_days is None or a['days_in_advance'] > best_days:
                    best_days = a['days_in_advance']

            if best_days is not None:
                cutoffTS = utils.today() + (best_days + 1) * 24 * 3600
                for b in apply_data['book']['dates']:
                    if b['fromTS'] >= cutoffTS:
                        return {"msg": "Forbidden", "code": 110}, 403

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
                        SeatAssign.login: l['login'],
                        SeatAssign.days_in_advance: l.get('days_in_advance')
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

        # If an everyone (null-login) row is present, anyone can still book — no conflicts
        has_everyone = any(l.get('login') is None for l in apply_data['assign']['logins'])

        if not has_everyone:
            new_logins = [l['login'] for l in apply_data['assign']['logins'] if l['login'] is not None]
            query = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                        .join(Users, on=(Book.login == Users.login)) \
                        .where((Book.fromts < ts['toTS']) & (Book.tots > ts['fromTS'])) \
                        .where(Book.sid == apply_data['assign']['sid']) \
                        .where(Users.login.not_in(new_logins))

            conflicts_in_assign = [
                {"sid": row['sid'],
                    "fromTS": row['fromts'],
                    "toTS": row['tots'],
                    "login": row['login'],
                    "username": row['name']} for row in query]

            if conflicts_in_assign:
                ret["conflicts_in_assign"] = conflicts_in_assign

    if 'assign' in apply_data:

        sid = apply_data['assign']['sid']
        everyone_row = next((l for l in apply_data['assign']['logins'] if l.get('login') is None), None)
        specific_logins = [l['login'] for l in apply_data['assign']['logins'] if l.get('login') is not None]

        for l in apply_data['assign']['logins']:
            if l.get('login') is None:
                continue  # everyone row handled below — applies to non-assignees
            dia = l.get('days_in_advance')
            if dia is not None:
                cutoff = utils.today() + (dia + 1) * 24 * 3600
                window_conflicts = [
                    {"sid": row['sid'],
                     "fromTS": row['fromts'],
                     "toTS": row['tots'],
                     "login": row['login'],
                     "username": row['name']}
                    for row in Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name)
                                   .join(Users, on=(Book.login == Users.login))
                                   .where(Book.sid == sid)
                                   .where(Book.login == l['login'])
                                   .where(Book.fromts >= cutoff)
                ]
                if window_conflicts:
                    if 'conflicts_in_window' not in ret:
                        ret['conflicts_in_window'] = []
                    ret['conflicts_in_window'].extend(window_conflicts)

        # Everyone-row window applies to bookings by users without their own (more permissive) row.
        # Most-permissive rule means users with a specific row are bound by their own days_in_advance.
        if everyone_row is not None:
            dia = everyone_row.get('days_in_advance')
            if dia is not None:
                cutoff = utils.today() + (dia + 1) * 24 * 3600
                q = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                        .join(Users, on=(Book.login == Users.login)) \
                        .where(Book.sid == sid) \
                        .where(Book.fromts >= cutoff)
                if specific_logins:
                    q = q.where(Book.login.not_in(specific_logins))

                window_conflicts = [
                    {"sid": row['sid'],
                     "fromTS": row['fromts'],
                     "toTS": row['tots'],
                     "login": row['login'],
                     "username": row['name']} for row in q]
                if window_conflicts:
                    if 'conflicts_in_window' not in ret:
                        ret['conflicts_in_window'] = []
                    ret['conflicts_in_window'].extend(window_conflicts)

    return ret, 200


autoBookSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "properties": {
        "dates": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "fromTS": {"type": "integer"},
                    "toTS": {"type": "integer"}
                },
                "required": ["fromTS", "toTS"]
            }
        }
    },
    "required": ["dates"]
}


# Format:
# {
#   "booked": [{sid, seat_name, fromTS, toTS}, ...],
#   "already_booked_elsewhere": [{sid, seat_name, zone_name, fromTS, toTS}, ...],
#   "unbookable": [{fromTS, toTS, future_options: [{sid, seat_name, available_from_ts, assignment_kind}, ...]}]
# }
@bp.route("autoBook/<int:zid>", methods=["POST"])
@utils.validateJSONInput(autoBookSchema)
def autoBook(zid):

    dates = flask.request.get_json()['dates']
    login = flask.g.login

    zone = Zone.select(Zone.zone_type, Zone.zone_group).where(Zone.id == zid).first()
    if zone is None:
        return {"msg": "Forbidden", "code": 130}, 403

    specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                  .where((UserToZoneRoles.zid == zid) & (UserToZoneRoles.login == login)) \
                                  .scalar()

    effectiveRole = effectiveZoneRole(zone['zone_type'], specificRole)
    if effectiveRole is None or effectiveRole > ZONE_ROLE_USER:
        return {"msg": "Forbidden", "code": 104}, 403

    ts = utils.getTimeRange()
    if not flask.g.isAdmin:
        for b in dates:
            if b['fromTS'] < ts["fromTS"] or b['fromTS'] > ts["toTS"] \
                or b['toTS'] < ts["fromTS"] or b['toTS'] > ts["toTS"]:
                return {"msg": "Forbidden", "code": 103}, 403

    # Reject inter-slot overlaps in the request — the book_overlap_insert
    # trigger would reject the bulk insert, wiping all otherwise-valid bookings.
    sortedDates = sorted(dates, key=lambda d: d['fromTS'])
    for i in range(len(sortedDates) - 1):
        if sortedDates[i]['toTS'] > sortedDates[i+1]['fromTS']:
            return {"msg": "Overlapping dates in request", "code": 140}, 400

    zoneGroup = zone['zone_group']
    today = utils.today()
    usageWindow = flask.current_app.config['AUTOBOOK_USAGE_WINDOW_DAYS']
    usageStart = today - usageWindow * 86400
    usageEnd = today + usageWindow * 86400

    # User's existing bookings in the zone_group overlapping any selected slot.
    # If found, the user is already covered for that slot — skip booking there:
    #  - same-zone:  silently (the booking is already visible on the map)
    #  - other-zone: report under already_booked_elsewhere so the UI can explain
    #                why no new booking was made for that slot.
    slotMin = min(b['fromTS'] for b in dates)
    slotMax = max(b['toTS'] for b in dates)

    existingQ = Book.select(Book.sid, Book.fromts, Book.tots, Seat.zid,
                            Seat.name.alias('seat_name'), Zone.name.alias('zone_name')) \
                    .join(Seat, on=(Book.sid == Seat.id)) \
                    .join(Zone, on=(Seat.zid == Zone.id)) \
                    .where(Zone.zone_group == zoneGroup) \
                    .where(Book.login == login) \
                    .where((Book.fromts < slotMax) & (Book.tots > slotMin))

    alreadyBookedElsewhere = []
    skipIdx = set()
    for eb in existingQ.iterator():
        for i, slot in enumerate(dates):
            if i in skipIdx:
                continue
            if eb['fromts'] < slot['toTS'] and eb['tots'] > slot['fromTS']:
                if eb['zid'] != zid:
                    alreadyBookedElsewhere.append({
                        "sid": eb['sid'],
                        "seat_name": eb['seat_name'],
                        "zone_name": eb['zone_name'],
                        "fromTS": slot['fromTS'],
                        "toTS": slot['toTS']
                    })
                skipIdx.add(i)

    remainingSlots = [dates[i] for i in range(len(dates)) if i not in skipIdx]

    assignments = {}
    unbookable = []
    if remainingSlots:
        assignments, unbookable = _autoBookAlgorithm(
            zid, zoneGroup, login, remainingSlots, today, usageStart, usageEnd)

    booked = []
    if assignments:
        insertData = []
        for ri, (sid, seatName) in assignments.items():
            slot = remainingSlots[ri]
            insertData.append({
                Book.login: login,
                Book.sid: sid,
                Book.fromts: slot['fromTS'],
                Book.tots: slot['toTS']
            })
            booked.append({
                "sid": sid,
                "seat_name": seatName,
                "fromTS": slot['fromTS'],
                "toTS": slot['toTS']
            })

        try:
            with DB.atomic():
                Book.insert(insertData).execute()
        except peewee.IntegrityError:
            return {"msg": "Overlapping time", "code": 109}, 400

    result = {
        "booked": booked,
        "already_booked_elsewhere": alreadyBookedElsewhere,
        "unbookable": unbookable
    }

    return flask.current_app.response_class(
        response=orjson.dumps(result),
        status=200,
        mimetype='application/json')


# Priority for choosing the user's strongest relation to a seat.
# Higher value wins — direct > group > everyone > none (no assignments) > blocked.
_KIND_PRIORITY = {'blocked': 0, 'none': 1, 'everyone': 2, 'group': 3, 'direct': 4}


def _bestKind(current, new):
    return new if _KIND_PRIORITY[new] > _KIND_PRIORITY[current] else current


def _autoBookAlgorithm(zid, zoneGroup, login, slots, today, usageStart, usageEnd):
    """
    Core auto-book selection algorithm.
    Returns (assignments, unbookable) where:
      assignments: {slot_index: (sid, seat_name)}  for slots that the caller should book
      unbookable:  [{fromTS, toTS, future_options}] for slots that could not be filled
    """

    # Enabled seats in zone
    seats = {s['id']: s['name'] for s in
             Seat.select(Seat.id, Seat.name)
                 .where((Seat.zid == zid) & (Seat.enabled == True)).iterator()}

    if not seats:
        return {}, [{"fromTS": s['fromTS'], "toTS": s['toTS'], "future_options": []} for s in slots]

    seatIds = list(seats.keys())

    # All seat_assign rows for these seats
    seatAssigns = defaultdict(list)
    for r in SeatAssign.select(SeatAssign.sid, SeatAssign.login, SeatAssign.days_in_advance) \
                       .where(SeatAssign.sid.in_(seatIds)).iterator():
        seatAssigns[r['sid']].append((r['login'], r['days_in_advance']))

    userGroups = _resolveUserGroups(login)

    # For each seat, classify the user's relation and compute the most-permissive
    # days_in_advance across direct, all matching group rows, and the everyone row.
    # This mirrors the most-permissive merge done in `apply`.
    #   kind: 'direct' | 'group' | 'everyone' | 'none' (no rows at all) | 'blocked' (only foreign)
    #   dia : None means unlimited (wins); otherwise MAX across applicable rows.
    seatInfo = {}
    for sid in seatIds:
        rows = seatAssigns.get(sid)
        if not rows:
            seatInfo[sid] = ('none', None)
            continue
        kind = 'blocked'
        applicableDias = []
        for rlogin, rdia in rows:
            if rlogin == login:
                kind = _bestKind(kind, 'direct')
                applicableDias.append(rdia)
            elif rlogin is None:
                kind = _bestKind(kind, 'everyone')
                applicableDias.append(rdia)
            elif rlogin in userGroups:
                kind = _bestKind(kind, 'group')
                applicableDias.append(rdia)
        if kind == 'blocked':
            continue   # user can't book this seat — excluded from every tier
        if any(d is None for d in applicableDias):
            dia = None
        else:
            dia = max(applicableDias)
        seatInfo[sid] = (kind, dia)

    tierA = {sid: dia for sid, (k, dia) in seatInfo.items() if k == 'direct'}
    tierB = {sid: dia for sid, (k, dia) in seatInfo.items() if k == 'group'}
    tierD = {sid: dia for sid, (k, dia) in seatInfo.items() if k in ('everyone', 'none')}

    hasAssignment = bool(tierA or tierB)

    # Tier C — only when no user-specific assignment exists; ranked by user's
    # booking count desc, ties broken by least-booked overall (lower total wins).
    tierC = {}
    userBookCounts = {}
    totalBookCounts = {}
    if not hasAssignment:
        userBookCounts = _seatBookCount(zid, usageStart, usageEnd, login=login)
        totalBookCounts = _seatBookCount(zid, usageStart, usageEnd, login=None)
        for sid in userBookCounts:
            if sid in seatInfo:    # seatInfo excludes 'blocked'
                tierC[sid] = seatInfo[sid][1]

    tierSeq = [('A', tierA), ('B', tierB), ('D', tierD)] if hasAssignment \
              else [('C', tierC), ('D', tierD)]

    # All bookings in zone_group overlapping the slot range — used for conflict checks
    slotMin = min(s['fromTS'] for s in slots)
    slotMax = max(s['toTS'] for s in slots)
    allBookings = list(Book.select(Book.sid, Book.login, Book.fromts, Book.tots)
                           .join(Seat, on=(Book.sid == Seat.id))
                           .join(Zone, on=(Seat.zid == Zone.id))
                           .where(Zone.zone_group == zoneGroup)
                           .where((Book.fromts < slotMax) & (Book.tots > slotMin))
                           .iterator())

    def seatHasOverlap(sid, slot, ignoreLogin=None):
        for bk in allBookings:
            if bk['sid'] != sid:
                continue
            if ignoreLogin is not None and bk['login'] == ignoreLogin:
                continue
            if bk['fromts'] < slot['toTS'] and bk['tots'] > slot['fromTS']:
                return True
        return False

    def userHasOverlap(slot):
        for bk in allBookings:
            if bk['login'] == login and bk['fromts'] < slot['toTS'] and bk['tots'] > slot['fromTS']:
                return True
        return False

    def withinWindow(dia, slot):
        return dia is None or slot['fromTS'] < today + (dia + 1) * 86400

    def covers(sid, dia, slot):
        return withinWindow(dia, slot) and not seatHasOverlap(sid, slot) and not userHasOverlap(slot)

    def rankTier(tag, seatsMap):
        ids = list(seatsMap.keys())
        if tag == 'C':
            ids.sort(key=lambda sid: (-userBookCounts.get(sid, 0),
                                       totalBookCounts.get(sid, 0),
                                       sid))
        else:
            ids.sort()
        return ids

    remaining = list(range(len(slots)))
    assignments = {}

    for tag, seatsMap in tierSeq:

        if not remaining or not seatsMap:
            continue

        ranked = rankTier(tag, seatsMap)

        # Phase 1 — same-seat preference: try a single seat that covers ALL remaining.
        # The strict tier ordering ensures an assigned-tier seat that covers only some
        # slots beats a non-assigned seat that covers all (assigned-overrides-same-seat).
        for sid in ranked:
            dia = seatsMap[sid]
            if all(covers(sid, dia, slots[i]) for i in remaining):
                for i in remaining:
                    assignments[i] = (sid, seats[sid])
                remaining = []
                break

        if not remaining:
            break

        # Phase 2 — per-slot fallback within this tier
        for i in list(remaining):
            for sid in ranked:
                dia = seatsMap[sid]
                if covers(sid, dia, slots[i]):
                    assignments[i] = (sid, seats[sid])
                    remaining.remove(i)
                    break

    # Unbookable slots + "come back later" hints
    unbookable = []
    for i in range(len(slots)):
        if i in assignments:
            continue
        slot = slots[i]
        futureOpts = []

        # Future hints are only meaningful for seats the user is allowed to book
        # AND that have a finite days_in_advance window (otherwise no future date
        # changes availability). 'none'-kind seats have no window; 'blocked' is excluded.
        for sid, (kind, dia) in seatInfo.items():
            if kind in ('none', 'blocked') or dia is None:
                continue
            cutoff = today + (dia + 1) * 86400
            if slot['fromTS'] < cutoff:
                continue   # currently in window — unbookable for another reason, not dia
            # Ignore the user's own bookings (those would be re-bookable in a separate call)
            # but a seat taken by someone else for that slot is not actually a future option.
            if seatHasOverlap(sid, slot, ignoreLogin=login):
                continue
            availableFromTs = ((slot['fromTS'] // 86400) - dia) * 86400
            futureOpts.append({
                "sid": sid,
                "seat_name": seats[sid],
                "available_from_ts": availableFromTs,
                "assignment_kind": kind
            })

        futureOpts.sort(key=lambda o: (o['available_from_ts'], o['sid']))
        unbookable.append({
            "fromTS": slot['fromTS'],
            "toTS": slot['toTS'],
            "future_options": futureOpts
        })

    return assignments, unbookable


def _resolveUserGroups(login):
    """All groups the user is a transitive member of.
    Mirrors the recursive expansion used by the user_to_zone_roles view."""
    res = set()
    cur = DB.execute_sql("""
        WITH RECURSIVE ug(grp) AS (
            SELECT g."group" FROM groups g WHERE g.login = %s
            UNION
            SELECT g."group" FROM groups g JOIN ug ON g.login = ug.grp
        )
        SELECT grp FROM ug
    """, (login,))
    for (g,) in cur:
        res.add(g)
    return res


def _seatBookCount(zid, fromTS, toTS, login=None):
    """Count bookings per seat in the given range, for enabled seats in zid.
    If login is None, counts across all users."""
    q = Book.select(Book.sid, COUNT_STAR.alias('cnt')) \
            .join(Seat, on=(Book.sid == Seat.id)) \
            .where((Seat.zid == zid) & (Seat.enabled == True)) \
            .where((Book.fromts < toTS) & (Book.tots > fromTS))
    if login is not None:
        q = q.where(Book.login == login)
    q = q.group_by(Book.sid)
    return {r['sid']: r['cnt'] for r in q.iterator()}


#Format
# {
#   data: {
#         login1: "User 1"
#         login2: "User 2"
#         ...
#       }
# }
@bp.route("getUsers/<zid>")
def getUsers(zid):

    zone = Zone.select(Zone.zone_type).where(Zone.id == zid).first()
    if zone is None:
        return {"msg": "Forbidden", "code": 120}, 403

    zone_type = zone['zone_type']

    specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                  .where((UserToZoneRoles.zid == zid) & (UserToZoneRoles.login == flask.g.login)) \
                                  .scalar()

    if not flask.g.isAdmin and specificRole != ZONE_ROLE_ADMIN:
        return {"msg": "Forbidden", "code": 120}, 403

    if zone_type in (ZONE_TYPE_PUBLIC_VIEW, ZONE_TYPE_PUBLIC_BOOK):
        userQuery = Users.select(Users.login, Users.name) \
                        .where(Users.account_type < ACCOUNT_TYPE_BLOCKED)
    else:
        userQuery = UserToZoneRoles.select(Users.login, Users.name) \
                                   .join(Users, on=(UserToZoneRoles.login == Users.login)) \
                                   .where(UserToZoneRoles.zid == zid)

    res = {u['login']: u['name'] for u in userQuery.iterator()}

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')
