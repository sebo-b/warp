"""
Debug-only blueprint — only registered when app.debug is True (DevelopmentSettings).
Provides endpoints to control "virtual time" for e2e tests.
"""
import flask
from . import utils

bp = flask.Blueprint('debug', __name__)


@bp.route('/debug/time', methods=['GET'])
def get_time():
    return {
        'now': utils.now(),
        'today': utils.today(),
        'offset_seconds': utils._debug_time_offset,
    }


@bp.route('/debug/set_time_offset', methods=['POST'])
def set_time_offset():
    """Shift utils.now() / utils.today() by offset_seconds.  Pass 0 to reset."""
    data = flask.request.get_json(silent=True) or {}
    offset = int(data.get('offset_seconds', 0))
    utils._debug_time_offset = offset
    return {
        'msg': 'ok',
        'offset_seconds': offset,
        'now': utils.now(),
        'today': utils.today(),
    }


@bp.route('/debug/endpoints', methods=['GET'])
def list_endpoints():
    """Return all non-debug registered routes — used by the e2e coverage test."""
    rules = [
        {
            'endpoint': r.endpoint,
            'rule': r.rule,
        }
        for r in flask.current_app.url_map.iter_rules()
        if r.endpoint != 'static' and not r.endpoint.startswith('debug.')
    ]
    return flask.jsonify(sorted(rules, key=lambda x: x['rule']))
