from collections import defaultdict
import random
import flask
from jsonschema import validate, ValidationError
import orjson
import peewee

from warp import auth
from warp import utils
from warp.db import *

bp = flask.Blueprint('plan', __name__, url_prefix='plan')

# Response format for getSeats:
#   zones: { zidN: "Zone name" }
#   users: { login: "name" }
#   seats: {
#       sidN: {          # seat visible to this user (in an accessible zone)
#          name, x, y, zid, enabled, bookable,
#          book: [ { bid, login, fromTS, toTS } ],
#          assignments: [ { login, days_in_advance, isEveryone? } ]
#       }
#       sidM: {          # seat in an inaccessible zone of the same plan (conflict display only)
#          name, zid,
#          book: [ { bid, login, fromTS, toTS } ]
#       }
#   }
#
# bookable: true if the relevant user's effective role for this seat's zone is
#           ≤ ZONE_ROLE_USER (i.e. they can actually book the seat). False for
#           VIEWER-only access or for seats in DISABLED zones (even if admin there
#           — disabled zones are fully locked down and should not allow booking
#           from the UI). The "relevant user" is normally the authenticated user,
#           but under book-as (?login=target) it is the target user, so the UI
#           only offers seats apply()/autoBook would actually let them book.
#
# Optional query args:
#   login=string       – view/operate the plan as this login (book-as; requires
#                        plan admin). Conflict bookings are scoped to this login.
@bp.route("getSeats/<int:pid>")
def getSeats(pid):

    # Verify plan exists and fetch timezone for TZ-aware window/grid seeds
    plan = Plan.select(Plan.id, Plan.timezone).where(Plan.id == pid).first()
    if plan is None:
        return {"msg": "Forbidden", "code": 130}, 403
    plan_tz = plan['timezone'] or None
    open_tz = plan_tz or 'UTC'

    res = {"seats": {}, "plan_timezone": open_tz}

    # Zones that have seats on this plan
    zone_rows = list(Zone.select(Zone.id, Zone.zone_type)
                     .join(Seat, on=(Seat.zid == Zone.id))
                     .where(Seat.pid == pid)
                     .group_by(Zone.id, Zone.zone_type)
                     .iterator())

    zone_type_map = {z['id']: z['zone_type'] for z in zone_rows}
    all_plan_zids = set(zone_type_map.keys())

    # User's effective role per zone (the view is the single source of truth —
    # it already resolves public-zone "everyone" roles and DISABLED ADMIN-only
    # filtering).
    effective_roles = {}
    if all_plan_zids:
        for row in UserToZoneRoles.select(UserToZoneRoles.zid, UserToZoneRoles.zone_role) \
                                  .where(UserToZoneRoles.zid.in_(list(all_plan_zids))) \
                                  .where(UserToZoneRoles.login == flask.g.login) \
                                  .iterator():
            effective_roles[row['zid']] = row['zone_role']

    # A site admin (flask.g.isAdmin) administers every zone, even ones they are
    # not explicitly assigned to — this mirrors the bypasses in view.plan /
    # view.planImage / zone.getUsers, so a site admin can actually open and
    # manage any plan.
    if flask.g.isAdmin:
        for zid in all_plan_zids:
            effective_roles[zid] = ZONE_ROLE_ADMIN

    if not effective_roles:
        return {"msg": "Forbidden", "code": 130}, 403

    accessible_zids = set(effective_roles.keys())
    is_plan_admin = any(r <= ZONE_ROLE_ADMIN for r in effective_roles.values())

    # Book-as: ?login=target lets a plan admin view and operate the plan as
    # another user (requires plan admin). Fetched once and reused below.
    targetLogin = flask.request.args.get('login')

    if targetLogin is not None:
        if not is_plan_admin:
            return {"msg": "Forbidden", "code": 131}, 403

        # Validate the target login is accessible on this plan: a row in the
        # view against the actor's OWN accessible zones means the target shares
        # at least one administered zone (non-public) or, for a public plan, the
        # admin has a synthetic row on the public zone and every user has one
        # too — so any non-group user validates.  The view's account_type < 100
        # filter excludes group logins (more correct for book-as than the old
        # any_public branch, which only checked Users.login existence).
        loginInPlan = UserToZoneRoles.select(SQL_ONE) \
            .where(UserToZoneRoles.zid.in_(list(accessible_zids))) \
            .where(UserToZoneRoles.login == targetLogin) \
            .scalar()
        if loginInPlan is None:
            return {"msg": "Forbidden", "code": 132}, 403

    # Whose booking permission decides `bookable`. Normally the authenticated
    # user. Under book-as (?login=target) the admin views the plan through the
    # target's eyes, so `bookable` must reflect whether *target* can book each
    # seat — otherwise seats the target can't book (e.g. VIEWER-only zones) would
    # look bookable yet apply()/autoBook would reject them (code 104). Visibility
    # of seats still follows the admin's (effective_roles) access.
    bookable_roles = effective_roles
    if targetLogin is not None and targetLogin != flask.g.login:
        # Roles from the view are already effective — query once for the target.
        target_roles = {}
        if accessible_zids:
            for row in UserToZoneRoles.select(UserToZoneRoles.zid, UserToZoneRoles.zone_role) \
                                      .where(UserToZoneRoles.zid.in_(list(accessible_zids))) \
                                      .where(UserToZoneRoles.login == targetLogin) \
                                      .iterator():
                target_roles[row['zid']] = row['zone_role']
        bookable_roles = target_roles

    tr = utils.getTimeRange(tz=plan_tz)
    usedZids = set()
    usedUsers = set()

    # Assignments for accessible seats
    assignCursor = SeatAssign.select(SeatAssign.sid, SeatAssign.login, SeatAssign.days_in_advance) \
        .join(Seat, on=(SeatAssign.sid == Seat.id)) \
        .where(Seat.pid == pid) \
        .where(Seat.zid.in_(list(accessible_zids)))

    assignments = defaultdict(list)
    for r in assignCursor:
        entry = {'login': r['login'], 'days_in_advance': r['days_in_advance']}
        if r['login'] is None:
            entry['isEveryone'] = True
        else:
            usedUsers.add(r['login'])
        assignments[r['sid']].append(entry)

    seatsCursor = Seat.select(Seat.id, Seat.name, Seat.x, Seat.y, Seat.zid, Seat.enabled) \
        .where(Seat.pid == pid) \
        .where(Seat.zid.in_(list(accessible_zids)))

    for s in seatsCursor.iterator():
        zid = s['zid']
        zone_role = effective_roles[zid]
        # Non-admins of this zone don't see disabled seats
        if not s['enabled'] and zone_role > ZONE_ROLE_ADMIN:
            continue

        book_role = bookable_roles.get(zid)
        seatD = {
            "name": s['name'],
            "x": s['x'],
            "y": s['y'],
            "zid": zid,
            "enabled": s['enabled'] != 0,
            "bookable": book_role is not None and book_role <= ZONE_ROLE_USER and zone_type_map[zid] != ZONE_TYPE_DISABLED,
            "book": []
        }
        if s['id'] in assignments:
            seatD['assignments'] = [*assignments[s['id']]]
        res['seats'][str(s['id'])] = seatD
        usedZids.add(zid)

    bookQuery = Book.select(Book.id, Book.login, Book.sid, Users.name.alias('username'), Book.fromts, Book.tots) \
        .join(Users, on=(Book.login == Users.login)) \
        .join(Seat, on=(Book.sid == Seat.id)) \
        .where((Book.fromts < tr['toTS']) & (Book.tots > tr['fromTS'])) \
        .where(Seat.pid == pid) \
        .where(Seat.zid.in_(list(accessible_zids))) \
        .order_by(Book.fromts)

    for b in DB.execute(bookQuery):
        sid = str(b[2])
        if sid not in res['seats']:
            continue
        res['seats'][sid]['book'].append({
            "bid": b[0],
            "login": b[1],
            "fromTS": b[4],
            "toTS": b[5]
        })
        usedUsers.add(b[1])

    # Conflict bookings: the user's bookings that share an exclusivity scope
    # with a zone on this plan but are not already visible above. The scope
    # mirrors book_overlap_insert: a named zone_group spans every zone in that
    # group (across plans), an ungrouped zone is exclusive only to itself.
    # Returning these lets the frontend flag CAN_REBOOK instead of CAN_BOOK for
    # inaccessible same-plan zones AND for same-group zones on other plans.
    # We scan all_plan_zids (not usedZids) so inaccessible same-group zones are
    # covered even when no booking made them appear in usedZids yet.
    login = targetLogin if targetLogin is not None else flask.g.login

    conflict_zids = set()
    plan_zone_groups = set()
    for z in Zone.select(Zone.id, Zone.zone_group).where(Zone.id.in_(list(all_plan_zids))).iterator():
        if z['zone_group'] is None:
            conflict_zids.add(z['id'])          # ungrouped: exclusive to itself
        else:
            plan_zone_groups.add(z['zone_group'])

    if plan_zone_groups:
        for z in Zone.select(Zone.id).where(Zone.zone_group.in_(list(plan_zone_groups))).iterator():
            conflict_zids.add(z['id'])          # grouped: every zone in the group

    if conflict_zids:
        already_present_sids = [int(sid) for sid in res['seats']]

        # Use book_utc to get real instants and translate to the open plan's
        # wall-clock scale so the frontend's integer overlap logic compares in
        # one scale unchanged. A display payload (fromStr/toStr/tz) is added for
        # bookings from a different TZ so the UI can show their own-office time.
        # Real instant -> open-plan wall-clock -> fake-UTC int (the inverse of
        # book_utc's derivation); open_tz is a parameterised literal (Value),
        # not interpolated, so a plan.timezone value can never reach SQL text.
        open_from = peewee.fn.date_part('epoch',
            peewee.Expression(peewee.Expression(BookUTC.from_utc, 'AT TIME ZONE', peewee.Value(open_tz)),
                              'AT TIME ZONE', peewee.SQL("'UTC'"))).cast('bigint')
        open_to = peewee.fn.date_part('epoch',
            peewee.Expression(peewee.Expression(BookUTC.to_utc, 'AT TIME ZONE', peewee.Value(open_tz)),
                              'AT TIME ZONE', peewee.SQL("'UTC'"))).cast('bigint')

        conflict_q = (BookUTC
            .select(BookUTC.sid, Seat.name, BookUTC.zid, BookUTC.bid, BookUTC.login,
                    BookUTC.fromts, BookUTC.tots,
                    open_from.alias('from_open'), open_to.alias('to_open'),
                    BookUTC.timezone)
            .join(Seat, on=(BookUTC.sid == Seat.id))
            .where(BookUTC.zid.in_(list(conflict_zids)))
            .where(BookUTC.login == login)
            # bu.fromts/tots are the booking's OWN-plan wall-clock,
            # while the window tr is the OPEN plan's - a cross-TZ booking
            # straddling the window edge may be hinted slightly off. The
            # book_overlap_insert trigger is the authoritative exclusivity guard,
            # so this is display-only. Upgrade: compare the translated open-scale
            # instants (from_open/to_open) in the WHERE too.
            .where(BookUTC.fromts < tr['toTS'])
            .where(BookUTC.tots > tr['fromTS'])
            .order_by(BookUTC.fromts))
        if already_present_sids:
            conflict_q = conflict_q.where(BookUTC.sid.not_in(already_present_sids))

        for b in conflict_q.iterator():
            sid = str(b['sid'])
            if sid not in res['seats']:
                res['seats'][sid] = {"name": b['name'], "zid": b['zid'], "book": []}
                usedZids.add(b['zid'])
            book_entry = {"bid": b['bid'], "login": b['login'],
                          "fromTS": b['from_open'], "toTS": b['to_open']}
            # Display payload for bookings on a different-TZ plan: show time in
            # the booking's own office TZ (fromts/tots are already that wall-clock).
            booking_tz = b['timezone']
            if booking_tz and booking_tz != open_tz:
                book_entry["fromStr"] = utils.formatTimestamp(b['fromts'])
                book_entry["toStr"]   = utils.formatTimestamp(b['tots'])
                book_entry["tz"]      = booking_tz
            res['seats'][sid]['book'].append(book_entry)
            usedUsers.add(b['login'])

    usedZonesQuery = Zone.select(Zone.id, Zone.name, Zone.zone_group).where(Zone.id.in_(usedZids)).tuples()
    res['zones'] = {}
    # zoneGroups maps zid -> zone_group (null = ungrouped). The client uses it to
    # scope booking conflicts per zone-group (or per single zone when null),
    # matching the book_overlap_insert trigger, instead of per whole plan.
    res['zoneGroups'] = {}
    for i in usedZonesQuery.iterator():
        res['zones'][str(i[0])] = i[1]
        res['zoneGroups'][str(i[0])] = i[2]

    usedUsersQuery = Users.select(Users.login, Users.name).where(Users.login.in_(usedUsers)).tuples()
    res['users'] = {str(i[0]): i[1] for i in usedUsersQuery.iterator()}

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')


applySchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "properties": {
        "enable": {"type": "array", "items": {"type": "integer"}},
        "disable": {"type": "array", "items": {"type": "integer"}},
        "assign": {
            "type": "object",
            "properties": {
                "sid": {"type": "integer"},
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
                "sid": {"type": "integer"},
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
            "required": ["sid", "dates"],
        },
        "remove": {"type": "array", "items": {"type": "integer"}}
    },
    "anyOf": [
        {"required": ["enable"]},
        {"required": ["disable"]},
        {"required": ["assign"]},
        {"required": ["book"]},
        {"required": ["remove"]}
    ]
}


@bp.route("apply", methods=["POST"])
@utils.validateJSONInput(applySchema)
def apply():

    apply_data = flask.request.get_json()
    # Resolve the plan's TZ for TZ-aware booking-window checks. Only needed when
    # a booking is being created; other operations (enable/disable/assign/remove)
    # fall back to the default TZ, which is fine for those admin-side paths.
    plan_tz = None
    if 'book' in apply_data:
        seat_plan_tz = Seat.select(Plan.timezone.alias('timezone')) \
            .join(Plan, on=(Seat.pid == Plan.id)) \
            .where(Seat.id == apply_data['book']['sid']) \
            .tuples().first()
        if seat_plan_tz:
            plan_tz = seat_plan_tz[0] or None
    ts = utils.getTimeRange(tz=plan_tz)

    seatsReqZoneAdmin = set()
    if 'enable' in apply_data: seatsReqZoneAdmin.update(apply_data['enable'])
    if 'disable' in apply_data: seatsReqZoneAdmin.update(apply_data['disable'])
    if 'assign' in apply_data: seatsReqZoneAdmin.add(apply_data['assign']['sid'])
    if 'book' in apply_data and 'login' in apply_data['book']: seatsReqZoneAdmin.add(apply_data['book']['sid'])

    if 'remove' in apply_data:
        removeQ = Book.select(Book.sid) \
                      .where(Book.id.in_(apply_data['remove'])) \
                      .where(Book.login != flask.g.login).tuples()
        seatsReqZoneAdmin.update([i[0] for i in removeQ.iterator()])

    # Site admins administer every zone, so they skip the per-seat zone-admin check.
    if seatsReqZoneAdmin and not flask.g.isAdmin:
        count = Seat.select(COUNT_STAR) \
                    .join(UserToZoneRoles, on=(Seat.zid == UserToZoneRoles.zid)) \
                    .where(UserToZoneRoles.login == flask.g.login) \
                    .where(Seat.id.in_(seatsReqZoneAdmin)) \
                    .where(UserToZoneRoles.zone_role <= ZONE_ROLE_ADMIN) \
                    .scalar()
        if count != len(seatsReqZoneAdmin):
            return {"msg": "Forbidden", "code": 102}, 403

    if 'assign' in apply_data:
        null_count = sum(1 for l in apply_data['assign']['logins'] if l.get('login') is None)
        if null_count > 1:
            return {"msg": "At most one 'everyone' assignment allowed per seat", "code": 111}, 400

    if 'book' in apply_data:

        if not flask.g.isAdmin:
            for b in apply_data['book']['dates']:
                if b['fromTS'] < ts["fromTS"] or b['fromTS'] > ts["toTS"] \
                        or b['toTS'] < ts["fromTS"] or b['toTS'] > ts["toTS"]:
                    return {"msg": "Forbidden", "code": 103}, 403

        sid = apply_data['book']['sid']
        login = apply_data['book'].get('login', flask.g.login)

        seatZone = Seat.select(Seat.enabled, Seat.zid, Zone.zone_type.alias('zone_type')) \
                       .join(Zone, on=(Seat.zid == Zone.id)) \
                       .where(Seat.id == sid) \
                       .first()

        if seatZone is None:
            return {"msg": "Forbidden", "code": 104}, 403

        bookerRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                    .where((UserToZoneRoles.zid == seatZone['zid']) & (UserToZoneRoles.login == login)) \
                                    .scalar()

        # bookerRole from the view IS the effective role.
        isSelfAdminBooking = flask.g.isAdmin and login == flask.g.login

        if not isSelfAdminBooking and (bookerRole is None or bookerRole > ZONE_ROLE_USER):
            return {"msg": "Forbidden", "code": 104}, 403

        # Disabled zones cannot be booked at all — even by admins.
        # Enable the zone first, then book.
        if seatZone['zone_type'] == ZONE_TYPE_DISABLED:
            return {"msg": "Forbidden", "code": 104}, 403

        if not seatZone['enabled']:
            return {"msg": "Forbidden", "code": 105}, 403

        assignedQ = SeatAssign.select(SQL_ONE).where(SeatAssign.sid == sid)
        if assignedQ.scalar() is not None:
            myAssignments = list(SeatAssign.select(SeatAssign.days_in_advance)
                                           .where((SeatAssign.sid == sid) &
                                                  ((SeatAssign.login == login) | SeatAssign.login.is_null()))
                                           .iterator())
            if not myAssignments:
                return {"msg": "Forbidden", "code": 106}, 403

            best_days = None
            for a in myAssignments:
                if a['days_in_advance'] is None:
                    best_days = None
                    break
                if best_days is None or a['days_in_advance'] > best_days:
                    best_days = a['days_in_advance']

            if best_days is not None:
                cutoffTS = utils.today(tz=plan_tz) + (best_days + 1) * 24 * 3600
                for b in apply_data['book']['dates']:
                    if b['fromTS'] >= cutoffTS:
                        return {"msg": "Forbidden", "code": 110}, 403

    class ApplyError(Exception):
        pass

    removed_owners = set()

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
                        raise ApplyError("Number of affected rows differs", 107)

            if 'remove' in apply_data:
                removed_owners = {row[0] for row in
                                  Book.select(Book.login)
                                      .where(Book.id.in_(apply_data['remove']))
                                      .tuples()}
                rowCount = Book.delete().where(Book.id.in_(apply_data['remove'])).execute()
                if rowCount != len(apply_data['remove']):
                    raise ApplyError("Number of affected rows differs", 108)

            if 'book' in apply_data:
                sid = apply_data['book']['sid']
                login = apply_data['book'].get('login', flask.g.login)
                insertData = [{
                    Book.login: login,
                    Book.sid: sid,
                    Book.fromts: x['fromTS'],
                    Book.tots: x['toTS']
                } for x in apply_data['book']['dates']]
                try:
                    Book.insert(insertData).execute()
                except peewee.IntegrityError:
                    raise ApplyError("Overlapping time", 109)

    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1]}, 400

    from warp.ical import invalidate_calendar_cache
    logins_to_invalidate = {flask.g.login} | removed_owners
    if 'book' in apply_data:
        logins_to_invalidate.add(apply_data['book'].get('login', flask.g.login))
    invalidate_calendar_cache(logins_to_invalidate)

    ret = {"msg": "ok"}

    if 'disable' in apply_data:
        query = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                    .join(Users, on=(Book.login == Users.login)) \
                    .where((Book.fromts < ts['toTS']) & (Book.tots > ts['fromTS'])) \
                    .where(Book.sid.in_(apply_data['disable']))
        conflicts_in_disable = [
            {"sid": row['sid'], "fromTS": row['fromts'], "toTS": row['tots'],
             "login": row['login'], "username": row['name']} for row in query
        ]
        if conflicts_in_disable:
            ret["conflicts_in_disable"] = conflicts_in_disable

    if 'assign' in apply_data and len(apply_data['assign']['logins']) > 0:
        has_everyone = any(l.get('login') is None for l in apply_data['assign']['logins'])
        if not has_everyone:
            new_logins = [l['login'] for l in apply_data['assign']['logins'] if l['login'] is not None]
            query = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                        .join(Users, on=(Book.login == Users.login)) \
                        .where((Book.fromts < ts['toTS']) & (Book.tots > ts['fromTS'])) \
                        .where(Book.sid == apply_data['assign']['sid']) \
                        .where(Users.login.not_in(new_logins))
            conflicts_in_assign = [
                {"sid": row['sid'], "fromTS": row['fromts'], "toTS": row['tots'],
                 "login": row['login'], "username": row['name']} for row in query
            ]
            if conflicts_in_assign:
                ret["conflicts_in_assign"] = conflicts_in_assign

    if 'assign' in apply_data:
        sid = apply_data['assign']['sid']
        everyone_row = next((l for l in apply_data['assign']['logins'] if l.get('login') is None), None)
        specific_logins = [l['login'] for l in apply_data['assign']['logins'] if l.get('login') is not None]

        for l in apply_data['assign']['logins']:
            if l.get('login') is None:
                continue
            dia = l.get('days_in_advance')
            if dia is not None:
                cutoff = utils.today(tz=plan_tz) + (dia + 1) * 24 * 3600
                window_conflicts = [
                    {"sid": row['sid'], "fromTS": row['fromts'], "toTS": row['tots'],
                     "login": row['login'], "username": row['name']}
                    for row in Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name)
                                   .join(Users, on=(Book.login == Users.login))
                                   .where(Book.sid == sid)
                                   .where(Book.login == l['login'])
                                   .where(Book.fromts >= cutoff)
                ]
                if window_conflicts:
                    ret.setdefault('conflicts_in_window', []).extend(window_conflicts)

        if everyone_row is not None:
            dia = everyone_row.get('days_in_advance')
            if dia is not None:
                cutoff = utils.today(tz=plan_tz) + (dia + 1) * 24 * 3600
                q = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                        .join(Users, on=(Book.login == Users.login)) \
                        .where(Book.sid == sid) \
                        .where(Book.fromts >= cutoff)
                if specific_logins:
                    q = q.where(Book.login.not_in(specific_logins))
                window_conflicts = [
                    {"sid": row['sid'], "fromTS": row['fromts'], "toTS": row['tots'],
                     "login": row['login'], "username": row['name']} for row in q
                ]
                if window_conflicts:
                    ret.setdefault('conflicts_in_window', []).extend(window_conflicts)

    return ret, 200


autoBookSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
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
        },
        "login": {"type": "string"}
    },
    "required": ["dates"],
    "additionalProperties": False
}


def runAutoBook(login, pid, dates, allowedZids=None, releaseZids=None):
    """Core autobook algorithm.

    Selects the best seat on the plan (pid) for the given login and dates.
    When allowedZids is given, only seats in those zones are eligible — used to
    confine a zone admin booking *as* another user to the zones they administer.
    When releaseZids is given, existing bookings may only be deleted if they are
    in one of those zones — used to confine the release side of a book-as operation.
    None means no confinement (current behaviour for self-book / iCal / site admin).
    Returns (result_dict, None) on success or (None, error_code) on failure.
    Error codes: 103 (time out of window), 140 (overlapping dates), 109 (DB conflict), 130 (bad pid).
    """

    # Verify plan exists and get accessible seats for this user
    plan = Plan.select(Plan.id, Plan.timezone).where(Plan.id == pid).first()
    if plan is None:
        return None, 130
    plan_tz = plan['timezone'] or None

    ts = utils.getTimeRange(tz=plan_tz)
    for b in dates:
        if b['fromTS'] < ts["fromTS"] or b['fromTS'] > ts["toTS"] \
                or b['toTS'] < ts["fromTS"] or b['toTS'] > ts["toTS"]:
            return None, 103

    sortedDates = sorted(dates, key=lambda d: d['fromTS'])
    for i in range(len(sortedDates) - 1):
        if sortedDates[i]['toTS'] > sortedDates[i + 1]['fromTS']:
            return None, 140

    today = utils.today(tz=plan_tz)
    usageWindow = flask.current_app.config['AUTOBOOK_USAGE_WINDOW_DAYS']
    usageStart = today - usageWindow * 86400
    usageEnd = today + usageWindow * 86400

    slotMin = min(b['fromTS'] for b in dates)
    slotMax = max(b['toTS'] for b in dates)

    # Existing bookings for this user on this plan within the slot range
    existingQ = list(Book.select(Book.id, Book.sid, Book.fromts, Book.tots, Seat.zid,
                                 Seat.name.alias('seat_name'), Zone.name.alias('zone_name'), Zone.zone_group)
                     .join(Seat, on=(Book.sid == Seat.id))
                     .join(Zone, on=(Seat.zid == Zone.id))
                     .where(Seat.pid == pid)
                     .where(Book.login == login)
                     .where((Book.fromts < slotMax) & (Book.tots > slotMin)).dicts())

    slots_by_day = defaultdict(list)
    for d in dates:
        day_key = d['fromTS'] - d['fromTS'] % (24 * 3600)
        slots_by_day[day_key].append(d)

    # Seats accessible to this user on this plan (excluding DISABLED zones).
    # The expanded view includes synthetic USER rows for PUBLIC_BOOK zones, so
    # a single INNER JOIN captures both assigned and public-bookable seats.
    accessibleSeatQ = Seat.select(Seat.id, Seat.name, Seat.zid) \
        .join(Zone, on=(Seat.zid == Zone.id)) \
        .join(UserToZoneRoles, on=(Seat.zid == UserToZoneRoles.zid)) \
        .where(Seat.pid == pid) \
        .where(Seat.enabled == True) \
        .where(Zone.zone_type != ZONE_TYPE_DISABLED) \
        .where(UserToZoneRoles.login == login) \
        .where(UserToZoneRoles.zone_role <= ZONE_ROLE_USER)

    if allowedZids is not None:
        allowedZidsList = list(allowedZids)
        accessibleSeatQ = accessibleSeatQ.where(Seat.zid.in_(allowedZidsList))

    seats = {}
    seat_zids = {}
    for s in accessibleSeatQ.dicts():
        seats[s['id']] = s['name']
        seat_zids[s['id']] = s['zid']

    # zone_group for each zone that appears on this plan
    zone_group_map = {}  # zid -> zone_group (None if ungrouped)
    for z in Zone.select(Zone.id, Zone.zone_group) \
                 .join(Seat, on=(Seat.zid == Zone.id)) \
                 .where(Seat.pid == pid) \
                 .group_by(Zone.id, Zone.zone_group).dicts():
        zone_group_map[z['id']] = z['zone_group']

    seatIds = list(seats.keys())
    seatAssigns = defaultdict(list)
    for r in SeatAssign.select(SeatAssign.sid, SeatAssign.login, SeatAssign.days_in_advance) \
                       .where(SeatAssign.sid.in_(seatIds)).dicts():
        seatAssigns[r['sid']].append((r['login'], r['days_in_advance']))

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
        if kind == 'blocked':
            continue
        if any(d is None for d in applicableDias):
            dia = None
        else:
            dia = max(applicableDias)
        seatInfo[sid] = (kind, dia)

    # Booked TIME per seat (not a count) over the usage window — both the
    # subject's own (to find their most-used seats) and everyone's (to spread).
    your_time = _seatBookTime(pid, usageStart, usageEnd, login=login)
    overall_time = _seatBookTime(pid, usageStart, usageEnd, login=None)

    # Eligible-seat count per zone, for the "biggest zone" step.
    zone_elig_count = defaultdict(int)
    for sid in seatInfo:
        zone_elig_count[seat_zids[sid]] += 1

    # ----- Day-independent candidate order: the selection priority (steps 2-6 of
    # AUTOBOOK.md). Step 1 (extend the seat you already hold) is handled per day.
    def _spread_key(sid):
        # least globally-used first, then a random tie-break so we spread people out
        return (overall_time.get(sid, 0), random.random())

    # Step 2: seats assigned to the subject, by descending days-in-advance
    # (unlimited first), then the subject's own usage, then spread.
    def _dia_rank(dia):
        return float('inf') if dia is None else dia

    assigned_order = sorted(
        (sid for sid, (k, _d) in seatInfo.items() if k == 'direct'),
        key=lambda sid: (-_dia_rank(seatInfo[sid][1]), -your_time.get(sid, 0)) + _spread_key(sid))

    # Steps 3-6 work on the shared pool (everyone / unassigned).
    shared = [sid for sid, (k, _d) in seatInfo.items() if k in ('everyone', 'none')]
    shared_order = []

    # Steps 3-4: your most-used shared seat, then the rest of that seat's zone.
    used_shared = [sid for sid in shared if your_time.get(sid, 0) > 0]
    home_zone = None
    if used_shared:
        top_sid = max(used_shared, key=lambda sid: (your_time[sid], -sid))
        home_zone = seat_zids[top_sid]
        home_seats = [sid for sid in shared if seat_zids[sid] == home_zone]
        home_seats.sort(key=lambda sid: (-your_time.get(sid, 0),) + _spread_key(sid))
        shared_order += home_seats

    rest = [sid for sid in shared if seat_zids[sid] != home_zone]

    # Step 5: the biggest remaining zone (most eligible seats), spread within it.
    if rest:
        biggest_zone = max({seat_zids[sid] for sid in rest},
                           key=lambda z: (zone_elig_count[z], -z))
        biggest_seats = [sid for sid in rest if seat_zids[sid] == biggest_zone]
        biggest_seats.sort(key=_spread_key)
        shared_order += biggest_seats
        rest = [sid for sid in rest if seat_zids[sid] != biggest_zone]

    # Step 6: anything left, at random.
    random.shuffle(rest)
    shared_order += rest

    candidate_order = assigned_order + shared_order

    # All bookings on this plan within slot range (for conflict detection)
    allBookings = list(Book.select(Book.id, Book.sid, Book.login, Book.fromts, Book.tots, Seat.zid, Zone.zone_group)
                       .join(Seat, on=(Book.sid == Seat.id))
                       .join(Zone, on=(Seat.zid == Zone.id))
                       .where(Seat.pid == pid)
                       .where((Book.fromts < slotMax) & (Book.tots > slotMin)).dicts())

    def withinWindow(dia, slot):
        return dia is None or slot['fromTS'] < today + (dia + 1) * 86400

    def covers_all(sid, sid_zid, sid_zgroup, dia, day_slots, ignore_bids):
        for s in day_slots:
            if not withinWindow(dia, s): return False
            for bk in allBookings:
                if bk['fromts'] < s['toTS'] and bk['tots'] > s['fromTS']:
                    if bk['id'] in ignore_bids:
                        continue
                    if bk['sid'] == sid:
                        return False
                    if bk['login'] == login:
                        if sid_zgroup is not None:
                            # block if booking is in any zone of the same group
                            if bk['zone_group'] == sid_zgroup:
                                return False
                        else:
                            # block if booking is in the same zone
                            if bk['zid'] == sid_zid:
                                return False
        return True

    booked = []
    unbookable = []
    not_extended = []
    to_delete_bids = []
    to_insert_data = []

    for day_key, day_slots in slots_by_day.items():
        day_overlaps = []
        for eb in existingQ:
            for s in day_slots:
                if eb['fromts'] < s['toTS'] and eb['tots'] > s['fromTS']:
                    if eb not in day_overlaps:
                        day_overlaps.append(eb)

        if len(day_slots) == 1 and len(day_overlaps) == 1:
            eb = day_overlaps[0]
            slot = day_slots[0]
            if eb['fromts'] == slot['fromTS'] and eb['tots'] == slot['toTS']:
                booked.append({"sid": eb['sid'], "seat_name": eb['seat_name'],
                               "fromTS": slot['fromTS'], "toTS": slot['toTS']})
                continue

        preferred_sids = [eb['sid'] for eb in day_overlaps if eb['sid'] in seats]

        candidate_sid = None
        candidate_seat_name = None
        candidate_ignore_bids = []

        def conflict_bids(sid):
            """Collect existing booking ids that would conflict with booking this seat."""
            sid_zid = seat_zids[sid]
            sid_zgroup = zone_group_map.get(sid_zid)
            if sid_zgroup is not None:
                return [eb['id'] for eb in day_overlaps if eb['zone_group'] == sid_zgroup]
            return [eb['id'] for eb in day_overlaps if eb['zid'] == sid_zid]

        def can_release(bids):
            if releaseZids is None:
                return True
            bidset = set(bids)
            return all(eb['zid'] in releaseZids for eb in day_overlaps if eb['id'] in bidset)

        for sid in preferred_sids:
            if sid in seatInfo and seatInfo[sid][0] != 'blocked':
                sid_zid = seat_zids[sid]
                sid_zgroup = zone_group_map.get(sid_zid)
                bids = conflict_bids(sid)
                if can_release(bids) and covers_all(sid, sid_zid, sid_zgroup, seatInfo[sid][1], day_slots, bids):
                    candidate_sid = sid
                    candidate_seat_name = seats[sid]
                    candidate_ignore_bids = bids
                    break

        if not candidate_sid:
            for sid in candidate_order:
                if sid in preferred_sids: continue
                sid_zid = seat_zids[sid]
                sid_zgroup = zone_group_map.get(sid_zid)
                bids = conflict_bids(sid)
                if can_release(bids) and covers_all(sid, sid_zid, sid_zgroup, seatInfo[sid][1], day_slots, bids):
                    candidate_sid = sid
                    candidate_seat_name = seats[sid]
                    candidate_ignore_bids = bids
                    break

        if candidate_sid:
            to_delete_bids.extend(candidate_ignore_bids)
            for s in day_slots:
                to_insert_data.append({
                    Book.login: login,
                    Book.sid: candidate_sid,
                    Book.fromts: s['fromTS'],
                    Book.tots: s['toTS']
                })
                booked.append({
                    "sid": candidate_sid,
                    "seat_name": candidate_seat_name,
                    "fromTS": s['fromTS'],
                    "toTS": s['toTS']
                })
        else:
            if day_overlaps:
                for s in day_slots:
                    not_extended.append(s)
            else:
                for s in day_slots:
                    futureOpts = []
                    for sid, (kind, dia) in seatInfo.items():
                        if kind in ('none', 'blocked') or dia is None: continue
                        cutoff = today + (dia + 1) * 86400
                        if s['fromTS'] < cutoff: continue
                        has_overlap = any(bk['fromts'] < s['toTS'] and bk['tots'] > s['fromTS']
                                          and bk['sid'] == sid and bk['login'] != login
                                          for bk in allBookings)
                        if has_overlap: continue
                        availableFromTs = ((s['fromTS'] // 86400) - dia) * 86400
                        futureOpts.append({
                            "sid": sid,
                            "seat_name": seats[sid],
                            "available_from_ts": availableFromTs,
                            "assignment_kind": kind
                        })
                    futureOpts.sort(key=lambda o: (o['available_from_ts'], o['sid']))
                    unbookable.append({
                        "fromTS": s['fromTS'],
                        "toTS": s['toTS'],
                        "future_options": futureOpts
                    })

    if to_insert_data or to_delete_bids:
        try:
            with DB.atomic():
                if to_delete_bids:
                    Book.delete().where(Book.id.in_(to_delete_bids)).execute()
                if to_insert_data:
                    Book.insert(to_insert_data).execute()
        except peewee.IntegrityError:
            return None, 109

    result = {
        "booked": booked,
        "not_extended": not_extended,
        "unbookable": unbookable
    }
    return result, None


@bp.route("autoBook/<int:pid>", methods=["POST"])
@utils.validateJSONInput(autoBookSchema)
def autoBook(pid):

    payload = flask.request.get_json()
    dates = payload['dates']
    login = payload.get('login', flask.g.login)
    is_book_as = login != flask.g.login

    # Zones (with type) that have seats on this plan.
    zone_type_map = {
        z['id']: z['zone_type']
        for z in Zone.select(Zone.id, Zone.zone_type)
                     .join(Seat, on=(Seat.zid == Zone.id))
                     .where(Seat.pid == pid)
                     .group_by(Zone.id, Zone.zone_type).iterator()
    }
    if not zone_type_map:
        return {"msg": "Forbidden", "code": 104}, 403

    def _rolesFor(loginToCheck):
        roles = {}
        for r in UserToZoneRoles.select(UserToZoneRoles.zid, UserToZoneRoles.zone_role) \
                                .where(UserToZoneRoles.zid.in_(list(zone_type_map))) \
                                .where(UserToZoneRoles.login == loginToCheck).iterator():
            roles[r['zid']] = r['zone_role']
        return roles

    # Confine book-as to zones the actor administers: the seat pool
    # (allowedZids) and the set of bookings that may be released
    # (releaseZids) are both limited to manageableZids.  None means
    # unconfined (self-book, site admin, iCal).
    manageableZids = None
    if is_book_as and not flask.g.isAdmin:
        actor_roles = _rolesFor(flask.g.login)
        # Roles from the view are already effective — synthetic public-zone rows
        # are always USER/VIEWER (never ADMIN), so they cannot inflate
        # manageableZids beyond zones the actor actually administers.
        manageableZids = {
            zid for zid in zone_type_map
            if actor_roles.get(zid) == ZONE_ROLE_ADMIN
        }
        if not manageableZids:
            return {"msg": "Forbidden", "code": 104}, 403

    subject_roles = _rolesFor(login)
    zone_iter = manageableZids if manageableZids is not None else zone_type_map.keys()
    # Roles from the view are already effective; DISABLED is a business rule.
    can_book = any(
        zone_type_map[zid] != ZONE_TYPE_DISABLED
        and subject_roles.get(zid) is not None
        and subject_roles.get(zid) <= ZONE_ROLE_USER
        for zid in zone_iter
    )
    if not can_book:
        return {"msg": "Forbidden", "code": 104}, 403

    result, err = runAutoBook(login, pid, dates,
                              allowedZids=manageableZids,
                              releaseZids=manageableZids)

    if err == 103:
        return {"msg": "Forbidden", "code": 103}, 403
    elif err == 140:
        return {"msg": "Overlapping dates in request", "code": 140}, 400
    elif err == 109:
        return {"msg": "Overlapping time", "code": 109}, 400
    elif err is not None:
        return {"msg": "Forbidden", "code": err}, 403

    from warp.ical import invalidate_calendar_cache
    invalidate_calendar_cache(login)

    return flask.current_app.response_class(
        response=orjson.dumps(result),
        status=200,
        mimetype='application/json')


_KIND_PRIORITY = {'blocked': 0, 'none': 1, 'everyone': 2, 'direct': 3}


def _bestKind(current, new):
    return new if _KIND_PRIORITY[new] > _KIND_PRIORITY[current] else current


def _seatBookTime(pid, fromTS, toTS, login=None):
    """Total booked time (seconds) per seat on the plan within [fromTS, toTS).

    Seats are ranked by how much they have been *used* (summed booking duration),
    not by how many times they were booked — so a desk held all day outweighs a
    phone booth grabbed in many short slots.
    """
    q = Book.select(Book.sid, peewee.fn.SUM(Book.tots - Book.fromts).alias('total')) \
            .join(Seat, on=(Book.sid == Seat.id)) \
            .where((Seat.pid == pid) & (Seat.enabled == True)) \
            .where((Book.fromts < toTS) & (Book.tots > fromTS))
    if login is not None:
        q = q.where(Book.login == login)
    q = q.group_by(Book.sid)
    return {r['sid']: r['total'] for r in q.iterator()}


@bp.route("getUsers/<int:pid>")
def getUsers(pid):

    # Collect zones that have seats on this plan (zone_type not needed for the
    # access check — the view is the single source of truth).
    zone_rows = list(Zone.select(Zone.id)
                     .join(Seat, on=(Seat.zid == Zone.id))
                     .where(Seat.pid == pid)
                     .group_by(Zone.id)
                     .iterator())

    if not zone_rows:
        plan_exists = Plan.select(SQL_ONE).where(Plan.id == pid).scalar()
        if plan_exists is None:
            return {"msg": "Forbidden", "code": 120}, 403
        return flask.current_app.response_class(
            response=orjson.dumps({}), status=200, mimetype='application/json')

    all_zids = [z['id'] for z in zone_rows]

    # Admin check: a row with role == ADMIN on any plan zone.  Roles from the
    # view are already effective.
    is_plan_admin = UserToZoneRoles.select(SQL_ONE) \
        .where(UserToZoneRoles.login == flask.g.login) \
        .where(UserToZoneRoles.zid.in_(all_zids)) \
        .where(UserToZoneRoles.zone_role == ZONE_ROLE_ADMIN) \
        .exists()

    if not flask.g.isAdmin and not is_plan_admin:
        return {"msg": "Forbidden", "code": 120}, 403

    # All users with access on this plan, via the unified view.  The view
    # includes blocked users (account_type < 100) and excludes group logins
    # (account_type >= 100).  This removes the old has_public branch, which
    # inconsistently filtered out blocked users only for public-zone plans.
    userQuery = UserToZoneRoles.select(Users.login, Users.name) \
                               .join(Users, on=(UserToZoneRoles.login == Users.login)) \
                               .where(UserToZoneRoles.zid.in_(all_zids)) \
                               .group_by(Users.login, Users.name)

    res = {u['login']: u['name'] for u in userQuery.iterator()}

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')
