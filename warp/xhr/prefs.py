import flask
from jsonschema import validate, ValidationError

from warp.db import UserPrefs

bp = flask.Blueprint('prefs', __name__)

DEFAULT_TIME_FROM = 9 * 3600
DEFAULT_TIME_TO = 17 * 3600

prefsSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "default_zone": {"type": ["integer", "string", "null"]},
        "default_day": {"enum": ["same", "tomorrow", "boundary"]},
        "default_time": {
            "type": "array",
            "items": {"type": "integer", "minimum": 0, "maximum": 24 * 3600},
            "minItems": 2,
            "maxItems": 2
        },
    },
    "required": ["default_day", "default_time"]
}


def _row_to_prefs(row):
    return {
        "default_zone": row['default_zone'],
        "default_day": row['default_day'],
        "default_time": [row['default_time_from'], row['default_time_to']],
    }


def _coerce_default_zone(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def get_user_prefs(login):
    row = UserPrefs.select(
        UserPrefs.default_zone,
        UserPrefs.default_day,
        UserPrefs.default_time_from,
        UserPrefs.default_time_to,
    ).where(UserPrefs.login == login).first()

    if row:
        return _row_to_prefs(row)

    return {
        "default_zone": None,
        "default_day": "same",
        "default_time": [DEFAULT_TIME_FROM, DEFAULT_TIME_TO],
    }


@bp.route("/prefs", methods=['GET'])
def prefs_get():
    return get_user_prefs(flask.g.login)


@bp.route("/prefs", methods=['POST'])
def prefs_set():
    if not flask.request.is_json:
        return {"msg": "Non-JSON request", "code": 10}, 404

    try:
        jsonData = flask.request.get_json()
        validate(jsonData, prefsSchema)
    except ValidationError:
        return {"msg": "Data error", "code": 13}, 400

    time_from, time_to = jsonData['default_time']
    if time_from >= time_to:
        return {"msg": "Data error", "code": 13}, 400

    values = {
        UserPrefs.login: flask.g.login,
        UserPrefs.default_zone: _coerce_default_zone(jsonData.get('default_zone')),
        UserPrefs.default_day: jsonData['default_day'],
        UserPrefs.default_time_from: time_from,
        UserPrefs.default_time_to: time_to
    }

    update = {
        UserPrefs.default_zone: values[UserPrefs.default_zone],
        UserPrefs.default_day: values[UserPrefs.default_day],
        UserPrefs.default_time_from: values[UserPrefs.default_time_from],
        UserPrefs.default_time_to: values[UserPrefs.default_time_to]
    }

    UserPrefs.insert(values).on_conflict(
        conflict_target=[UserPrefs.login],
        update=update
    ).execute()

    return get_user_prefs(flask.g.login)
