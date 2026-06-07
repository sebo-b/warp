import flask
from jsonschema import validate, ValidationError
from peewee import JOIN
import uuid

from warp.db import (DB, UserPrefs, UserToZoneRoles, Zone,
                     ZONE_ROLE_ADMIN, ZONE_ROLE_VIEWER,
                     ZONE_TYPE_ENABLED, ZONE_TYPE_PUBLIC_VIEW, ZONE_TYPE_PUBLIC_BOOK)

bp = flask.Blueprint('calendar', __name__)

calendarSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "ical_enabled": {"type": "boolean"},
        "ical_regenerate_token": {"type": "boolean"},
        "ensure_token": {"type": "boolean"},
        "reminder_weekdays": {"type": "integer", "minimum": 0, "maximum": 127},
        "reminder_ahead_days": {"type": "integer", "minimum": 0, "maximum": 7},
        "reminder_time": {"type": "integer", "minimum": 0, "maximum": 86399},
        "reminder_release_ahead_days": {"type": "integer", "minimum": 0, "maximum": 7},
        "reminder_zones": {"type": "array", "items": {"type": "integer"}}
    }
}

_PREFS_FIELDS = ('ical_enabled',
                 'reminder_weekdays', 'reminder_ahead_days', 'reminder_time',
                 'reminder_release_ahead_days')

_DEFAULTS = {
    "ical_enabled": False,
    "ical_token": None,
    "reminder_weekdays": 0,
    "reminder_ahead_days": 0,
    "reminder_time": 79200,
    "reminder_release_ahead_days": 0,
    "reminder_zones": [],
}


def _get_calendar_data(login):
    row = UserPrefs.select(
        UserPrefs.ical_enabled,
        UserPrefs.ical_token,
        UserPrefs.reminder_weekdays,
        UserPrefs.reminder_ahead_days,
        UserPrefs.reminder_time,
        UserPrefs.reminder_release_ahead_days,
        UserPrefs.reminder_zones,
    ).where(UserPrefs.login == login).first()

    if row is None:
        return dict(_DEFAULTS)

    return {key: row[key] if row[key] is not None else default
            for key, default in _DEFAULTS.items()}


def _accessible_zone_ids(login, zids):
    # Mirrors view.headerDataInit zone visibility: public zones, or ENABLED zones
    # with any role, or ADMIN role on any zone_type (including DISABLED).
    rows = (Zone.select(Zone.id)
                .join(UserToZoneRoles, JOIN.LEFT_OUTER,
                      on=((Zone.id == UserToZoneRoles.zid) & (UserToZoneRoles.login == login)))
                .where(Zone.id.in_(list(zids)))
                .where(
                    Zone.zone_type.in_([ZONE_TYPE_PUBLIC_VIEW, ZONE_TYPE_PUBLIC_BOOK]) |
                    ((Zone.zone_type == ZONE_TYPE_ENABLED) & (UserToZoneRoles.zone_role <= ZONE_ROLE_VIEWER)) |
                    (UserToZoneRoles.zone_role == ZONE_ROLE_ADMIN)
                )
                .tuples())
    return {r[0] for r in rows}


@bp.route("/calendar", methods=['GET'])
def calendar_get():
    return _get_calendar_data(flask.g.login)


@bp.route("/calendar", methods=['POST'])
def calendar_post():
    if not flask.request.is_json:
        return {"msg": "Non-JSON request", "code": 10}, 404

    try:
        jsonData = flask.request.get_json()
        validate(jsonData, calendarSchema)
    except ValidationError:
        return {"msg": "Data error", "code": 13}, 400

    login = flask.g.login

    if 'reminder_zones' in jsonData:
        requested_zones = list(dict.fromkeys(jsonData['reminder_zones']))
        if requested_zones:
            accessible = _accessible_zone_ids(login, requested_zones)
            if any(zid not in accessible for zid in requested_zones):
                return {"msg": "Forbidden", "code": 11}, 403
    else:
        requested_zones = None

    update = {}
    for field in _PREFS_FIELDS:
        if field in jsonData:
            update[getattr(UserPrefs, field)] = jsonData[field]

    if requested_zones is not None:
        update[UserPrefs.reminder_zones] = requested_zones

    if jsonData.get('ical_regenerate_token'):
        update[UserPrefs.ical_token] = uuid.uuid4().hex
    elif jsonData.get('ensure_token') or update.get(UserPrefs.ical_enabled) is True:
        # Allocate a token if none exists. The client requests this on first toggle so the
        # subscription URL can render immediately, without flipping ical_enabled (Save does that).
        existing_token = UserPrefs.select(UserPrefs.ical_token).where(UserPrefs.login == login).scalar()
        if not existing_token:
            update[UserPrefs.ical_token] = uuid.uuid4().hex

    if update:
        values = dict(update)
        values[UserPrefs.login] = login
        with DB.atomic():
            UserPrefs.insert(values).on_conflict(
                conflict_target=[UserPrefs.login],
                update=update
            ).execute()

        from warp.ical import invalidate_calendar_cache
        invalidate_calendar_cache(login)

    return _get_calendar_data(login)
