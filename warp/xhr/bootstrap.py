import flask

from warp.db import *
from warp.xhr.prefs import get_user_prefs
from warp import i18n

bp = flask.Blueprint('bootstrap', __name__)


@bp.route("/bootstrap", methods=["GET"])
def bootstrap():
    # NOTE: this GET intentionally has DB-write + Set-Cookie side effects. It
    # fires once per shell boot (cached by bootstrap.js), so it is idempotent
    # and bounded. It is the single place that reconciles the warp_lang cookie
    # with user_prefs.language for every authenticated session, regardless of
    # which auth backend established it.

    # Left nav: plans the user has access to (has accessible seats in at least
    # one zone). Mirrors the old headerDataInit context processor.
    accessible_zone_rows = Zone.select(Zone.id, Zone.name) \
        .join(UserToZoneRoles,
              on=((Zone.id == UserToZoneRoles.zid) & (UserToZoneRoles.login == flask.g.login))) \
        .order_by(Zone.name)

    zones = [{"id": z['id'], "name": z['name']} for z in accessible_zone_rows]
    accessible_zids = [z['id'] for z in zones]

    plans = []
    if accessible_zids:
        plan_rows = Plan.select(Plan.id, Plan.name) \
            .join(Seat, on=(Seat.pid == Plan.id)) \
            .where(Seat.zid.in_(accessible_zids)) \
            .group_by(Plan.id, Plan.name) \
            .order_by(Plan.name)
        plans = [{"id": p['id'], "name": p['name']} for p in plan_rows]

    prefs = get_user_prefs(flask.g.login)
    default_plan = prefs.get('default_plan')

    payload = {
        "plans": plans,
        "zones": zones,
        "defaultPlan": default_plan,
        "isAdmin": flask.g.isAdmin,
        "login": flask.g.login,
        "name": flask.g.name,
    }

    # --- cookie / prefs language sync (decision 1) ---
    # Prefs are authoritative while logged in; the cookie is only the
    # carry-across-logout transport. The active language itself is resolved
    # at render time (context processor); this block only reconciles the cookie
    # with prefs, never returns the active value.
    configured = set(i18n.configured_languages())
    cookie = flask.request.cookies.get('warp_lang')
    cookie_valid = cookie in configured

    pref = prefs.get('language')
    if pref not in configured:
        # A stored code the deployment later removed must not be echoed into
        # the cookie (the render path's resolve already ignores it).
        pref = None

    resp = flask.jsonify(payload)
    if pref is not None:
        # Prefs win. Correct a stale/differing/absent cookie to match.
        if cookie != pref:
            resp.set_cookie('warp_lang', pref, max_age=31536000, samesite='lax', path='/')
    elif cookie_valid:
        # No pref yet: persist the cookie choice so it sticks across logout.
        # Upsert (not a plain UPDATE): get_user_prefs synthesizes defaults
        # when no row exists, so an UPDATE would match zero rows and silently
        # no-op for exactly the never-saved users most likely to hit this.
        UserPrefs.insert({
            UserPrefs.login: flask.g.login,
            UserPrefs.language: cookie,
        }).on_conflict(
            conflict_target=[UserPrefs.login],
            update={UserPrefs.language: cookie}
        ).execute()
        # The persisted language changes this user's calendar feed text.
        from warp.ical import invalidate_calendar_cache
        invalidate_calendar_cache(flask.g.login)
    elif cookie is not None:
        # Invalid stale cookie: delete it so it stops shadowing the default.
        resp.delete_cookie('warp_lang', path='/')
    # else: no pref, no cookie -> nothing to do (render falls back to default).

    return resp
