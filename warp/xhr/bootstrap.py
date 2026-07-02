import flask

from warp.db import *
from warp.xhr.prefs import get_user_prefs

bp = flask.Blueprint('bootstrap', __name__)


@bp.route("/bootstrap", methods=["GET"])
def bootstrap():
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

    default_plan = get_user_prefs(flask.g.login).get('default_plan')

    return {
        "plans": plans,
        "zones": zones,
        "defaultPlan": default_plan,
        "isAdmin": flask.g.isAdmin,
        "login": flask.g.login,
        "name": flask.g.name,
    }
