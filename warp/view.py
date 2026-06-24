import flask

from warp.db import *
from . import utils
from . import blob_storage
from warp.xhr.prefs import get_user_prefs

bp = flask.Blueprint('view', __name__)


@bp.context_processor
def headerDataInit():

    # Left nav: plans the user has access to (has accessible seats in at least one zone)
    headerDataL = []

    # Zones accessible to user (for calendar reminder dropdown)
    accessible_zones = []

    # Plans accessible to user (for default_plan preference)
    accessible_plans = []

    # A row in the view means effective access (the view is the single source
    # of truth — it includes synthetic rows for public zones).
    accessible_zone_rows = Zone.select(Zone.id, Zone.name) \
        .join(UserToZoneRoles,
              on=((Zone.id == UserToZoneRoles.zid) & (UserToZoneRoles.login == flask.g.login))) \
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
            accessible_plans.append({"id": p['id'], "name": p['name']})
            headerDataL.append(
                {"text": p['name'], "endpoint": "view.plan", "view_args": {"pid": str(p['id'])}})

    if headerDataL:
        headerDataL.insert(0, {"text": "Bookings", "endpoint": "view.bookings", "view_args": {"report": ""}})

    headerDataR = [
        {"text": "Report", "endpoint": "view.bookings", "view_args": {"report": "report"}},
    ]

    for hdata in [headerDataL, headerDataR]:
        for h in hdata:
            h['url'] = flask.url_for(h['endpoint'], **h['view_args'])
            h['active'] = flask.request.endpoint == h['endpoint'] and flask.request.view_args == h['view_args']

    return {
        "headerDataL": headerDataL,
        "headerDataR": headerDataR,
        "accessibleZones": accessible_zones,
        "accessiblePlans": accessible_plans,
        'hasLogout': 'auth.logout' in flask.current_app.view_functions,
        'hasChangePassword': 'auth.change_password' in flask.current_app.view_functions,
        'minPasswordLength': flask.current_app.config.get('MIN_PASSWORD_LENGTH', 6)
    }


@bp.route("/")
def index():
    default_plan = get_user_prefs(flask.g.login).get('default_plan')

    if default_plan is not None:
        # Check if the plan is still accessible to the user: a row in the view
        # for any zone on the plan means access.
        has_access = UserToZoneRoles.select(SQL_ONE) \
            .where(UserToZoneRoles.login == flask.g.login) \
            .where(UserToZoneRoles.zid.in_(
                Zone.select(Zone.id).join(Seat, on=(Seat.zid == Zone.id))
                  .where(Seat.pid == default_plan)
            )).exists()
        if has_access:
            return flask.redirect(flask.url_for('view.plan', pid=default_plan))

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
    zone_rows = list(Zone.select(Zone.id)
                     .join(Seat, on=(Seat.zid == Zone.id))
                     .where(Seat.pid == pid)
                     .group_by(Zone.id)
                     .iterator())

    # Fetch the plan's dark-mode map filter once; since the column is NOT NULL, a
    # None result also doubles as the plan-existence check (no extra query needed).
    dark_filter = Plan.select(Plan.dark_filter).where(Plan.id == pid).scalar()
    if dark_filter is None:
        flask.abort(403)

    if not zone_rows and not flask.g.isAdmin:
        # Plan exists but has no seats — only an admin may open it.
        flask.abort(403)

    plan_zids = [z['id'] for z in zone_rows]

    # Effective roles from the view (single source of truth — already resolves
    # public-zone "everyone" roles and DISABLED ADMIN-only filtering).
    effective_roles = {}
    if plan_zids:
        for row in UserToZoneRoles.select(UserToZoneRoles.zid, UserToZoneRoles.zone_role) \
                .where(UserToZoneRoles.login == flask.g.login) \
                .where(UserToZoneRoles.zid.in_(plan_zids)).dicts():
            effective_roles[row['zid']] = row['zone_role']

    if not effective_roles and not flask.g.isAdmin:
        flask.abort(403)

    nextWeek = utils.getNextWeek()
    prefs = get_user_prefs(flask.g.login)
    default_time = prefs.get('default_time', [9 * 3600, 17 * 3600])
    default_day = prefs.get('default_day', 'same')

    zonePreviewPrefs = {
        'show_seat_names': prefs.get('zone_show_seat_names', False),
        'show_booking_preview': prefs.get('zone_show_booking_preview', False),
        'show_assigned_names': prefs.get('zone_show_assigned_names', False),
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
                                 dark_filter=dark_filter,
                                 nextWeek=nextWeek,
                                 today=utils.today(),
                                 defaultSelectedDates=defaultSelectedDates,
                                 zonePreviewPrefs=zonePreviewPrefs)


@bp.route("/plan/image/<pid>")
def planImage(pid):

    if not flask.g.isAdmin:
        # A row in the view for any zone on the plan means access.
        has_access = UserToZoneRoles.select(SQL_ONE) \
            .where(UserToZoneRoles.login == flask.g.login) \
            .where(UserToZoneRoles.zid.in_(
                Zone.select(Zone.id).join(Seat, on=(Seat.zid == Zone.id))
                  .where(Seat.pid == pid)
            )).exists()
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
                                 returnURL=returnURL,
                                 dark_filter=Plan.select(Plan.dark_filter).where(Plan.id == pid).scalar())
