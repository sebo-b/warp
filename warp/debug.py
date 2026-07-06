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
    """Switch the deployment fallback language for e2e (debug only).

    Sets DEFAULT_LANGUAGE at runtime (the per-user feature resolves a NULL
    user pref to this), and clears calendar_cache: cached feed rows are
    language-specific, so a switch must force regeneration. Accepts a
    `language` code ('de','en',...) or, for back-compat, a `language_file`
    path ('i18n/de.json') whose stem is used as the code. Reset with 'en'.
    """
    data = flask.request.get_json(silent=True) or {}
    code = data.get('language')
    if not code:
        lang_file = data.get('language_file') or 'i18n/en.json'
        code = lang_file.split('/')[-1].removesuffix('.json')
    # Reject a bogus code: the context processor / i18nUrl would build
    # i18n/<code>.json, which 404s and breaks the login page's i18n load.
    if code not in flask.current_app.config['LANGUAGES']:
        return {"msg": "unknown language", "code": 13}, 400
    flask.current_app.config['DEFAULT_LANGUAGE'] = code
    from warp.db import CalendarCache
    CalendarCache.delete().execute()
    return {
        'msg': 'ok',
        'language': code,
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
