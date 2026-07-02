import flask

from . import bookings
from . import plan
from . import users
from . import groups
from . import zones
from . import plans
from . import prefs
from . import calendar
from . import bootstrap

bp = flask.Blueprint('xhr', __name__)

bp.register_blueprint(bookings.bp)
bp.register_blueprint(plan.bp)
bp.register_blueprint(users.bp)
bp.register_blueprint(groups.bp)
bp.register_blueprint(zones.bp)
bp.register_blueprint(plans.bp)
bp.register_blueprint(prefs.bp)
bp.register_blueprint(calendar.bp)
bp.register_blueprint(bootstrap.bp)
