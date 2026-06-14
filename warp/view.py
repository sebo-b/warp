import flask
from peewee import JOIN

from warp.db import *
from . import utils
from . import blob_storage
from warp.xhr.prefs import get_user_prefs

bp = flask.Blueprint('view', __name__)


@bp.context_processor
def headerDataInit():

    # Left nav: plans the user has access to (has accessible seats in at least one zone)
    headerDataL = []

    # Zones accessible to user (for default_zone preference + calendar reminder dropdown)
    accessible_zones = []

    accessible_zone_rows = Zone.select(Zone.id, Zone.name) \
        .join(UserToZoneRoles, join_type=JOIN.LEFT_OUTER,
              on=((Zone.id == UserToZoneRoles.zid) & (UserToZoneRoles.login == flask.g.login))) \
        .where(
            Zone.zone_type.in_([ZONE_TYPE_PUBLIC_VIEW, ZONE_TYPE_PUBLIC_BOOK]) |
            ((Zone.zone_type == ZONE_TYPE_ENABLED) & (UserToZoneRoles.zone_role <= ZONE_ROLE_VIEWER)) |
            (UserToZoneRoles.zone_role == ZONE_ROLE_ADMIN)
        ) \
        .order_by(Zone.name)

    for z in accessible_zone_rows:
        accessible_zones.append({"id": z['id'], "name": z['name']})

    # Plans that have at least one seat in an accessible zone
    accessible_zids = [z['id'] for z in accessible_zones]

    if accessible_zids:
        plan_rows = Plan.select(Plan.id, Plan.name) \
            .join(Seat, on=(Seat.pid == Plan.id)) \
            .where(Seat.zid.in_(accessible_zids)) \
            .group_by(Plan.id, Plan.name) \
            .order_by(Plan.name)

        for p in plan_rows:
            headerDataL.append(
                {"text": p['name'], "endpoint": "view.plan", "view_args": {"pid": str(p['id'])}})

    if headerDataL:
        headerDataL.insert(0, {"text": "Bookings", "endpoint": "view.bookings", "view_args": {"report": ""}})

    headerDataR = [
        {"text": "Report", "endpoint": "view.bookings", "view_args": {"report": "report"}},
    ]

    headerDataAdmin = [
        {"group": "user_management", "text": "Users", "endpoint": "view.users", "view_args": {}},
        {"group": "user_management", "text": "Groups", "endpoint": "view.groups", "view_args": {}},
        {"group": "plan_management", "text": "Zones", "endpoint": "view.zones", "view_args": {}},
        {"group": "plan_management", "text": "Plans", "endpoint": "view.plans", "view_args": {}},
    ]

    for hdata in [headerDataL, headerDataR, headerDataAdmin]:
        for h in hdata:
            h['url'] = flask.url_for(h['endpoint'], **h['view_args'])
            h['active'] = flask.request.endpoint == h['endpoint'] and flask.request.view_args == h['view_args']

    return {
        "headerDataL": headerDataL,
        "headerDataR": headerDataR,
        "headerDataAdmin": headerDataAdmin,
        "accessibleZones": accessible_zones,
        'hasLogout': 'auth.logout' in flask.current_app.view_functions,
        'hasChangePassword': 'auth.change_password' in flask.current_app.view_functions,
        'minPasswordLength': flask.current_app.config.get('MIN_PASSWORD_LENGTH', 6)
    }


@bp.route("/")
def index():
    default_zone = get_user_prefs(flask.g.login).get('default_zone')

    if default_zone is not None:
        # Find a plan with a seat in the user's preferred zone that they can access
        zoneRow = Zone.select(Zone.zone_type).where(Zone.id == default_zone).first()
        if zoneRow:
            specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                .where((UserToZoneRoles.zid == default_zone) & (UserToZoneRoles.login == flask.g.login)) \
                .scalar()
            if effectiveZoneRole(zoneRow['zone_type'], specificRole) is not None:
                planRow = Plan.select(Plan.id) \
                    .join(Seat, on=(Seat.pid == Plan.id)) \
                    .where(Seat.zid == default_zone) \
                    .first()
                if planRow:
                    return flask.redirect(flask.url_for('view.plan', pid=planRow['id']))

    return flask.render_template('index.html')


@bp.route("/bookings/<string:report>")
@bp.route("/bookings", defaults={"report": ""})
def bookings(report):
    if report == "report" and not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('bookings.html',
                                 report=(report == "report"),
                                 maxReportRows=flask.current_app.config['MAX_REPORT_ROWS'])


@bp.route("/plan/<pid>")
def plan(pid):

    # Collect zones on this plan and check user access
    zone_rows = list(Zone.select(Zone.id, Zone.zone_type)
                     .join(Seat, on=(Seat.zid == Zone.id))
                     .where(Seat.pid == pid)
                     .group_by(Zone.id, Zone.zone_type)
                     .iterator())

    if not zone_rows:
        plan_exists = Plan.select(SQL_ONE).where(Plan.id == pid).scalar()
        if plan_exists is None:
            flask.abort(403)
        # Plan exists but has no seats — admin still needs access
        if not flask.g.isAdmin:
            flask.abort(403)

    effective_roles = {}
    for z in zone_rows:
        specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
            .where((UserToZoneRoles.zid == z['id']) & (UserToZoneRoles.login == flask.g.login)) \
            .scalar()
        eff = effectiveZoneRole(z['zone_type'], specificRole)
        if eff is not None:
            effective_roles[z['id']] = eff

    if not effective_roles and not flask.g.isAdmin:
        flask.abort(403)

    nextWeek = utils.getNextWeek()
    prefs = get_user_prefs(flask.g.login)
    default_time = prefs.get('default_time', [9 * 3600, 17 * 3600])
    default_day = prefs.get('default_day', 'same')

    zonePreviewPrefs = {
        'show_seat_names': prefs.get('zone_show_seat_names', False),
        'show_booking_preview': prefs.get('zone_show_booking_preview', False),
    }

    defaultSelectedDates = {"slider": default_time}

    now_ts = utils.now()
    today_ts = utils.today()
    seconds_into_day = now_ts - today_ts

    if default_day == 'boundary':
        target_ts = today_ts + (24 * 3600 if seconds_into_day >= default_time[0] else 0)
    elif default_day == 'tomorrow':
        target_ts = today_ts + (24 * 3600)
    else:
        target_ts = today_ts

    for d in nextWeek:
        if d['timestamp'] >= target_ts:
            defaultSelectedDates['cb'] = [d['timestamp']]
            break

    is_plan_admin = any(r <= ZONE_ROLE_ADMIN for r in effective_roles.values()) or flask.g.isAdmin
    is_plan_viewer = effective_roles and all(r >= ZONE_ROLE_VIEWER for r in effective_roles.values()) and \
                     not any(r <= ZONE_ROLE_USER for r in effective_roles.values())

    role_flags = {}
    if is_plan_admin:
        role_flags['isZoneAdmin'] = True
    elif is_plan_viewer:
        role_flags['isZoneViewer'] = True

    return flask.render_template('plan.html',
                                 **role_flags,
                                 pid=pid,
                                 nextWeek=nextWeek,
                                 today=utils.today(),
                                 defaultSelectedDates=defaultSelectedDates,
                                 zonePreviewPrefs=zonePreviewPrefs)


@bp.route("/plan/image/<pid>")
def planImage(pid):

    if not flask.g.isAdmin:
        zone_rows = list(Zone.select(Zone.id, Zone.zone_type)
                         .join(Seat, on=(Seat.zid == Zone.id))
                         .where(Seat.pid == pid)
                         .group_by(Zone.id, Zone.zone_type)
                         .iterator())
        has_access = False
        for z in zone_rows:
            specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                .where((UserToZoneRoles.zid == z['id']) & (UserToZoneRoles.login == flask.g.login)) \
                .scalar()
            if effectiveZoneRole(z['zone_type'], specificRole) is not None:
                has_access = True
                break
        if not has_access:
            flask.abort(403)

    blobIdQuery = Plan.select(Plan.iid.alias('id')).where(Plan.id == pid)
    return blob_storage.createBlobResponse(blobIdQuery=blobIdQuery)


@bp.route("/users")
def users():
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('users.html')


@bp.route("/groups")
def groups():
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('groups.html')


@bp.route("/zones")
def zones():
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('zones.html',
                                 ungroupedFilterKey=UNGROUPED_FILTER_KEY)


@bp.route("/plans")
def plans():
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('plans.html')


@bp.route("/groups/assign/<group_login>")
def groupAssign(group_login):
    if not flask.g.isAdmin:
        flask.abort(403)

    groupName = Users.select(Users.name) \
        .where((Users.login == group_login) & (Users.account_type >= ACCOUNT_TYPE_GROUP)) \
        .scalar()
    if groupName is None:
        flask.abort(404)

    returnURL = flask.request.args.get('return', flask.url_for('view.groups'))
    return flask.render_template('group_assign.html',
                                 groupLogin=group_login,
                                 groupName=groupName,
                                 returnURL=returnURL)


@bp.route("/zones/assign/<zid>")
def zoneAssign(zid):
    if not flask.g.isAdmin:
        flask.abort(403)

    zoneName = Zone.select(Zone.name).where(Zone.id == zid).scalar()
    if zoneName is None:
        flask.abort(404)

    returnURL = flask.request.args.get('return', flask.url_for('view.zones'))
    return flask.render_template('zone_assign.html',
                                 zoneName=zoneName,
                                 zid=zid,
                                 returnURL=returnURL)


@bp.route("/plans/modify/<pid>")
def planModify(pid):
    if not flask.g.isAdmin:
        flask.abort(403)

    returnURL = flask.request.args.get('return', flask.url_for('view.plans'))
    return flask.render_template('plan_modify.html',
                                 pid=pid,
                                 returnURL=returnURL)
