import flask

from warp import utils

from warp.db import UserPrefs

bp = flask.Blueprint('prefs', __name__)

DEFAULT_TIME_FROM = 9 * 3600
DEFAULT_TIME_TO = 17 * 3600

prefsSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "default_plan": {"type": ["integer", "string", "null"]},
        "default_day": {"enum": ["same", "tomorrow", "boundary"]},
        "default_time": {
            "type": "array",
            "items": {"type": "integer", "minimum": 0, "maximum": 24 * 3600},
            "minItems": 2,
            "maxItems": 2
        },
        "zone_show_seat_names": {"type": "boolean"},
        "zone_show_booking_preview": {"type": "boolean"},
        "zone_show_assigned_names": {"type": "boolean"},
        "language": {"type": ["string", "null"]},
    },
    "required": ["default_day", "default_time", "zone_show_seat_names", "zone_show_booking_preview", "zone_show_assigned_names", "language"],
    "additionalProperties": False
}


def _row_to_prefs(row):
    return {
        "default_plan": row['default_plan'],
        "default_day": row['default_day'],
        "default_time": [row['default_time_from'], row['default_time_to']],
        "zone_show_seat_names": row['zone_show_seat_names'],
        "zone_show_booking_preview": row['zone_show_booking_preview'],
        "zone_show_assigned_names": row['zone_show_assigned_names'],
        "language": row['language'],
    }


def _coerce_default_plan(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def get_user_prefs(login):
    row = UserPrefs.select(
        UserPrefs.default_plan,
        UserPrefs.default_day,
        UserPrefs.default_time_from,
        UserPrefs.default_time_to,
        UserPrefs.zone_show_seat_names,
        UserPrefs.zone_show_booking_preview,
        UserPrefs.zone_show_assigned_names,
        UserPrefs.language,
    ).where(UserPrefs.login == login).first()

    if row:
        return _row_to_prefs(row)

    return {
        "default_plan": None,
        "default_day": "same",
        "default_time": [DEFAULT_TIME_FROM, DEFAULT_TIME_TO],
        "zone_show_seat_names": False,
        "zone_show_booking_preview": False,
        "zone_show_assigned_names": False,
        "language": None,
    }


@bp.route("/prefs", methods=['GET'])
def prefs_get():
    return get_user_prefs(flask.g.login)


@bp.route("/prefs", methods=['POST'])
@utils.validateJSONInput(prefsSchema)
def prefs_set():
    jsonData = flask.request.get_json()
    time_from, time_to = jsonData['default_time']
    if time_from >= time_to:
        return {"msg": "Data error", "code": 13}, 400

    # The wire value for "Default" is JSON null (the client sends null, never
    # an empty string, which 400s at schema validation). Runtime in-LANGUAGES
    # gate: a code the deployment does not offer must not be stored (the
    # resolver would silently ignore it). The module-level schema cannot see
    # LANGUAGES, so this is the real gate.
    language = jsonData['language']
    if language is not None and language not in flask.current_app.config['LANGUAGES']:
        return {"msg": "Data error", "code": 13}, 400

    values = {
        UserPrefs.login: flask.g.login,
        UserPrefs.default_plan: _coerce_default_plan(jsonData.get('default_plan')),
        UserPrefs.default_day: jsonData['default_day'],
        UserPrefs.default_time_from: time_from,
        UserPrefs.default_time_to: time_to,
        UserPrefs.zone_show_seat_names: jsonData['zone_show_seat_names'],
        UserPrefs.zone_show_booking_preview: jsonData['zone_show_booking_preview'],
        UserPrefs.zone_show_assigned_names: jsonData['zone_show_assigned_names'],
        UserPrefs.language: language,
    }

    update = {
        UserPrefs.default_plan: values[UserPrefs.default_plan],
        UserPrefs.default_day: values[UserPrefs.default_day],
        UserPrefs.default_time_from: values[UserPrefs.default_time_from],
        UserPrefs.default_time_to: values[UserPrefs.default_time_to],
        UserPrefs.zone_show_seat_names: values[UserPrefs.zone_show_seat_names],
        UserPrefs.zone_show_booking_preview: values[UserPrefs.zone_show_booking_preview],
        UserPrefs.zone_show_assigned_names: values[UserPrefs.zone_show_assigned_names],
        UserPrefs.language: values[UserPrefs.language],
    }

    UserPrefs.insert(values).on_conflict(
        conflict_target=[UserPrefs.login],
        update=update
    ).execute()

    # A language change invalidates this user's calendar feed cache (feed text
    # is language-specific). Import here to avoid a circular import at module load.
    from warp.ical import invalidate_calendar_cache
    invalidate_calendar_cache(flask.g.login)

    # Mirror the choice into the warp_lang cookie so the next render (and the
    # post-logout login page) use it. null deletes the cookie so the deployment
    # default takes over. (The client also sets/deletes it so the reload on
    # change happens immediately; both agree.)
    resp = flask.jsonify(get_user_prefs(flask.g.login))
    if language is not None:
        resp.set_cookie('warp_lang', language, max_age=31536000, samesite='lax', path='/')
    else:
        resp.delete_cookie('warp_lang', path='/')
    return resp
