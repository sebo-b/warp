import flask

from . import bookings
from . import zone
from . import users

bp = flask.Blueprint('xhr', __name__)

bp.register_blueprint(bookings.bp)
bp.register_blueprint(zone.bp)
bp.register_blueprint(users.bp)
