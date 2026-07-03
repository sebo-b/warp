import json

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
    # Jinja data-min/max attrs on the per-page templates (now inlined into view
    # fragments Jinja never touches).
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
        # Backend sentinels consumed by JS (project rule: shared backend-JS
        # constants flow through window.warpGlobals, defined once — never
        # duplicated as JS literals). Renumbering a role/type in db.py must not
        # silently break the client-side filters/editors.
        'accountTypeGroup': ACCOUNT_TYPE_GROUP,
        'zoneRoles': {'admin': ZONE_ROLE_ADMIN, 'user': ZONE_ROLE_USER, 'viewer': ZONE_ROLE_VIEWER},
        'zoneTypes': {
            'disabled': ZONE_TYPE_DISABLED,
            'enabled': ZONE_TYPE_ENABLED,
            'publicView': ZONE_TYPE_PUBLIC_VIEW,
            'publicBook': ZONE_TYPE_PUBLIC_BOOK,
        },
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
        'plan': flask.url_for('view.plan', pid='__PID__'),
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

        # Shell modals (prefs / calendar). GET and POST share each path, so one
        # url_for entry (the GET endpoint) suffices. Routed through Utils.xhr in
        # JS — via these entries, not a hardcoded '/xhr/...' — so they share the
        # 401 session-expiry redirect + ref-counted spinner and stay correct
        # under a reverse-proxy mount prefix.
        'prefs': flask.url_for('xhr.prefs.prefs_get'),
        'calendar': flask.url_for('xhr.calendar.calendar_get'),
    }

    if 'auth.change_password' in flask.current_app.view_functions:
        urls['changePassword'] = flask.url_for('auth.change_password')

    return urls


def _admin_spa():
    """SPA shell for an admin-only route: cheap 403 guard + render spa.html.
    Shared by the seven admin views (users/groups/zones/plans + the two assigns
    + planModify) that used to each repeat the same two lines."""
    if not flask.g.isAdmin:
        flask.abort(403)
    return flask.render_template('spa.html')


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
    return _admin_spa()


@bp.route("/groups")
def groups():
    return _admin_spa()


@bp.route("/zones")
def zones():
    return _admin_spa()


@bp.route("/plans")
def plans():
    return _admin_spa()


@bp.route("/groups/assign/<group_login>")
def groupAssign(group_login):
    return _admin_spa()


@bp.route("/zones/assign/<zid>")
def zoneAssign(zid):
    return _admin_spa()


@bp.route("/plans/modify/<pid>")
def planModify(pid):
    return _admin_spa()


# --- PWA ---------------------------------------------------------------------
# Both files are served through app routes (not /static) on purpose:
# - the manifest's scope/start_url must be prefix-aware (url_for/SCRIPT_NAME),
#   which a static file can't be without a build step;
# - a service worker can only control paths at or below its own URL, so sw.js
#   must be served from the app root — /static/sw.js could only ever control
#   /static/*. The SW itself is a no-op (installability gate only, no offline).

@bp.route("/manifest.webmanifest")
def manifest():
    scope = flask.url_for('view.index')
    body = {
        'name': 'WARP',
        'short_name': 'WARP',
        'description': 'WARP workspace autobooking, reservation platform',
        'start_url': scope,
        'scope': scope,
        'display': 'standalone',
        'lang': 'en',
        'background_color': '#2C3E50',
        'theme_color': '#2C3E50',
        'icons': [
            {
                'src': flask.url_for('static', filename='images/icon-192.png'),
                'sizes': '192x192', 'type': 'image/png', 'purpose': 'any',
            },
            {
                'src': flask.url_for('static', filename='images/icon-512.png'),
                'sizes': '512x512', 'type': 'image/png', 'purpose': 'any',
            },
            {
                # Required for the Android 12+ system splash to render the icon
                # full-bleed instead of letterboxed in a white circle.
                'src': flask.url_for('static', filename='images/icon-512-maskable.png'),
                'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable',
            },
        ],
    }
    # json.dumps (not jsonify) keeps the key order of the dict above, so the
    # served manifest diffs cleanly against this source. no-cache = revalidate
    # each fetch (the spec-recommended manifest caching).
    resp = flask.Response(json.dumps(body, indent=2),
                          mimetype='application/manifest+json')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@bp.route("/sw.js")
def serviceWorker():
    # no-cache: today's SW is a no-op, but a cached SW is an upgrade-latency
    # trap the moment it gains real handlers — opt out of the static-file
    # max-age default now, while it's cheap.
    resp = flask.send_from_directory(
        flask.current_app.static_folder, 'sw.js',
        mimetype='text/javascript', max_age=None)
    resp.headers['Cache-Control'] = 'no-cache'
    return resp
