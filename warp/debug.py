"""
Debug-only blueprint — only registered when app.debug is True (DevelopmentSettings).
Provides endpoints to control "virtual time" for e2e tests.
"""
import flask
from . import utils

bp = flask.Blueprint('debug', __name__)


@bp.route('/debug/time', methods=['GET'])
def get_time():
    # Optional ?tz=<IANA> resolves now/today in that zone (PLAN per_plan_timezone
    # §7); without it, returns the clock in UTC (the feed/cache clock).
    tz = flask.request.args.get('tz') or 'UTC'
    if not utils.is_valid_iana(tz):
        return {"msg": "Invalid timezone"}, 400
    return {
        'now': utils.now(tz=tz),
        'today': utils.today(tz=tz),
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
        'now': utils.now(tz='UTC'),
        'today': utils.today(tz='UTC'),
    }


@bp.route('/debug/set_language', methods=['POST'])
def set_language():
    """Switch the deployment language for e2e (debug only).

    Sets LANGUAGE_FILE so _ical_phrases() loads another i18n file, and clears
    calendar_cache: cached feed rows are language-specific, so a switch must
    force regeneration. Pass 'i18n/en.json' (or omit) to reset to English.
    """
    data = flask.request.get_json(silent=True) or {}
    lang_file = data.get('language_file') or 'i18n/en.json'
    flask.current_app.config['LANGUAGE_FILE'] = lang_file
    from warp.db import CalendarCache
    CalendarCache.delete().execute()
    return {
        'msg': 'ok',
        'language_file': lang_file,
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
