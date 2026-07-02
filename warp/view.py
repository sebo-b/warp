import flask

from warp.db import *
from . import utils
from . import blob_storage

bp = flask.Blueprint('view', __name__)


@bp.context_processor
def spaGlobals():
    # Cheap (no DB) flags/constants spa.html needs at first paint, before
    # /xhr/bootstrap resolves — e.g. to decide whether to render the
    # change-password dialog, or to seed the timeslider ranges that used to be
    # Jinja data-min/max attrs (plan.html:172, base_logged.html:106) but now
    # live in view fragments Jinja never touches.
    config = flask.current_app.config
    return {
        'hasLogout': 'auth.logout' in flask.current_app.view_functions,
        'hasChangePassword': 'auth.change_password' in flask.current_app.view_functions,
        'minPasswordLength': config.get('MIN_PASSWORD_LENGTH', 6),
        'ungroupedFilterKey': UNGROUPED_FILTER_KEY,
        'maxReportRows': config['MAX_REPORT_ROWS'],
        'daysInAdvance': (config['WEEKS_IN_ADVANCE'] + 1) * 7,
        'bookOpen': config['BOOK_OPEN'],
        'bookClose': config['BOOK_CLOSE'],
        'spaURLs': spaURLs(),
    }


def _intUrlFor(endpoint, param, placeholder, **kwargs):
    """url_for a route whose dynamic segment uses the <int:...> converter,
    with a placeholder the client substitutes per-row instead of a real id.
    <int:...> rejects a non-numeric value outright, so build with a real int
    (0 — never a valid row id) and swap it back out; the value only ever
    appears as the route's trailing path segment, so the replacement is exact."""
    url = flask.url_for(endpoint, **{param: 0}, **kwargs)
    suffix = '/0'
    assert url.endswith(suffix), f"expected {endpoint} to end with {suffix}, got {url}"
    return url[:-len(suffix)] + '/' + placeholder


def spaURLs():
    """The full warpGlobals.URLs table, injected once into spa.html via
    url_for() — the single-definition union of the per-page URL tables that
    used to live in the 10 page templates. url_for is mount-prefix/proxy-aware,
    so this (not a hardcoded JS route table) is what keeps prefixed deployments
    working. __LOGIN__/__ZID__/__PID__ are placeholders the client substitutes
    per-row (Tabulator formatters, dialog opens, …)."""

    urls = {
        'login': flask.url_for('auth.login'),
        'distBase': flask.url_for('static', filename='dist/'),
        'bootstrap': flask.url_for('xhr.bootstrap.bootstrap'),
        'logoSvg': flask.url_for('static', filename='images/logo.svg'),

        'planImage': flask.url_for('view.planImage', pid='__PID__'),
        'planApply': flask.url_for('xhr.plan.apply'),
        'planGetSeat': _intUrlFor('xhr.plan.getSeats', 'pid', '__PID__'),
        'planAutoBook': _intUrlFor('xhr.plan.autoBook', 'pid', '__PID__'),
        'planGetUsers': _intUrlFor('xhr.plan.getUsers', 'pid', '__PID__'),
        'planGetContext': _intUrlFor('xhr.plan.getContext', 'pid', '__PID__'),
        'seatSprite': flask.url_for('static', filename='images/seat_icons.svg'),

        'usersList': flask.url_for('xhr.users.list'),
        'usersEdit': flask.url_for('xhr.users.edit'),
        'usersDelete': flask.url_for('xhr.users.delete'),
        'userGroups': flask.url_for('xhr.users.groups', login='__LOGIN__'),

        'groups': flask.url_for('view.groups'),
        'groupAssign': flask.url_for('view.groupAssign', group_login='__LOGIN__'),
        'groupMemberList': flask.url_for('xhr.groups.members'),
        'groupsAssignXHR': flask.url_for('xhr.groups.assign'),
        'groupInfo': flask.url_for('xhr.groups.info', login='__LOGIN__'),

        'zones': flask.url_for('view.zones'),
        'zonesList': flask.url_for('xhr.zones.list'),
        'zonesDelete': flask.url_for('xhr.zones.delete'),
        'zonesAddOrEdit': flask.url_for('xhr.zones.addOrEdit'),
        'zonesGroups': flask.url_for('xhr.zones.groups'),
        'zoneNames': flask.url_for('xhr.zones.names'),
        'zoneAssign': flask.url_for('view.zoneAssign', zid='__ZID__'),
        'zoneMembers': flask.url_for('xhr.zones.members'),
        'zoneAssignXHR': flask.url_for('xhr.zones.assign'),
        'zoneInfo': _intUrlFor('xhr.zones.info', 'zid', '__ZID__'),

        'plans': flask.url_for('view.plans'),
        'plansList': flask.url_for('xhr.plans.list'),
        'plansDelete': flask.url_for('xhr.plans.delete'),
        'plansAddOrEdit': flask.url_for('xhr.plans.addOrEdit'),
        'plansTimezones': flask.url_for('xhr.plans.timezones'),
        'planModify': flask.url_for('view.planModify', pid='__PID__'),
        'plansModifyXHR': flask.url_for('xhr.plans.modify'),
        'plansGetSeats': _intUrlFor('xhr.plans.getSeats', 'pid', '__PID__'),
        'plansZonesForPlan': flask.url_for('xhr.plans.zonesForPlan'),
        'plansAllZones': flask.url_for('xhr.plans.allZones'),

        'bookings': flask.url_for('view.bookings', report=''),
        'bookingsReportPage': flask.url_for('view.bookings', report='report'),
        'bookingsList': flask.url_for('xhr.bookings.list'),
        'bookingsReport': flask.url_for('xhr.bookings.report'),
        'bookingsContext': flask.url_for('xhr.bookings.context'),
        'excelIcon': flask.url_for('static', filename='images/excel_icon.png'),
    }

    if 'auth.change_password' in flask.current_app.view_functions:
        urls['changePassword'] = flask.url_for('auth.change_password')

    return urls


@bp.route("/")
def index():
    return flask.render_template('spa.html')


@bp.route("/bookings/<string:report>")
@bp.route("/bookings", defaults={"report": ""})
def bookings(report):
    if report == "report" and not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')


@bp.route("/plan/<pid>")
def plan(pid):
    return flask.render_template('spa.html')


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
    return flask.render_template('spa.html')


@bp.route("/groups")
def groups():
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')


@bp.route("/zones")
def zones():
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')


@bp.route("/plans")
def plans():
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')


@bp.route("/groups/assign/<group_login>")
def groupAssign(group_login):
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')


@bp.route("/zones/assign/<zid>")
def zoneAssign(zid):
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')


@bp.route("/plans/modify/<pid>")
def planModify(pid):
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')
