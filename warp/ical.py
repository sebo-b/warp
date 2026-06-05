import flask
import os
from time import gmtime, strftime
from warp import utils

from warp.db import UserPrefs, Book, Seat, SeatAssign, Zone

bp = flask.Blueprint('ical', __name__)

ICAL_HEADER = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Warp//Seat Booking//EN\r\n"
ICAL_FOOTER = "END:VCALENDAR\r\n"

# Server-side translations for VEVENT SUMMARY strings. The iCal feed has no
# session context, so locale is taken from the deployment-wide LANGUAGE_FILE
# config (e.g. "i18n/de.js" → "de"). Falls back to English for unknown codes.
_SUMMARY_TRANSLATIONS = {
    'en': {
        'booking': 'Seat {name}',
        'missing': 'Book a desk in {zone}',
        'release': 'Seat {name} becomes available',
    },
    'pl': {
        'booking': 'Miejsce {name}',
        'missing': 'Zarezerwuj miejsce w {zone}',
        'release': 'Miejsce {name} staje się dostępne',
    },
    'de': {
        'booking': 'Platz {name}',
        'missing': 'Platz in {zone} buchen',
        'release': 'Platz {name} wird verfügbar',
    },
    'fr': {
        'booking': 'Place {name}',
        'missing': 'Réserver une place dans {zone}',
        'release': 'Place {name} devient disponible',
    },
    'es': {
        'booking': 'Asiento {name}',
        'missing': 'Reservar un asiento en {zone}',
        'release': 'Asiento {name} se vuelve disponible',
    },
}


def _summary_templates():
    lang_file = flask.current_app.config.get('LANGUAGE_FILE', '')
    locale = os.path.splitext(os.path.basename(lang_file))[0]
    return _SUMMARY_TRANSLATIONS.get(locale, _SUMMARY_TRANSLATIONS['en'])


def _ts_to_ical_dt(ts):
    return strftime("%Y%m%dT%H%M%SZ", gmtime(ts))

def _escape_ical_text(text):
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _format_vevent(uid, dtstamp, dtstart, dtend, summary):
    return ("BEGIN:VEVENT\r\n"
            f"UID:{uid}\r\n"
            f"DTSTAMP:{dtstamp}\r\n"
            f"DTSTART:{dtstart}\r\n"
            f"DTEND:{dtend}\r\n"
            f"SUMMARY:{summary}\r\n"
            "END:VEVENT\r\n")


def _reminder_vevents(login, now_ts, today_ts, summaries):
    """Return list of VEVENT strings for calendar reminder events."""

    row = UserPrefs.select(
        UserPrefs.reminder_weekdays,
        UserPrefs.reminder_ahead_days,
        UserPrefs.reminder_time,
        UserPrefs.reminder_release_ahead_days,
        UserPrefs.reminder_zones,
    ).where(UserPrefs.login == login).first()

    if row is None:
        return []

    weekdays_mask = row['reminder_weekdays']
    ahead_days = row['reminder_ahead_days']
    reminder_time = row['reminder_time']
    release_ahead_days = row['reminder_release_ahead_days']
    reminder_zones = row['reminder_zones']
    missing_enabled = ahead_days > 0
    release_enabled = release_ahead_days > 0

    # Both reminder kinds require monitored zones, so a missing list short-circuits.
    if not reminder_zones or (not missing_enabled and not release_enabled):
        return []

    # Fetch private seats that have a public release row (NULL login with days_in_advance set).
    private_seats = []
    if release_enabled:
        sa_user = SeatAssign.alias('sa_user')
        sa_pub = SeatAssign.alias('sa_pub')
        private_seats = list(sa_user.select(sa_user.sid, Seat.zid, sa_pub.days_in_advance, Seat.name)
                                    .join(sa_pub, on=(sa_user.sid == sa_pub.sid))
                                    .join(Seat, on=(Seat.id == sa_user.sid))
                                    .where((sa_user.login == login) &
                                           sa_pub.login.is_null() &
                                           sa_pub.days_in_advance.is_null(False) &
                                           Seat.zid.in_(reminder_zones))
                                    .tuples())

    if not missing_enabled and not private_seats:
        return []

    # Horizon: look 30 days ahead (covers practical reminder windows)
    horizon_days = 30
    horizon_ts = today_ts + horizon_days * 24 * 3600

    booking_rows = (Book.select(Book.fromts, Seat.zid)
                        .join(Seat, on=(Book.sid == Seat.id))
                        .where((Book.login == login) & (Book.tots > today_ts) & (Book.fromts < horizon_ts))
                        .tuples())

    booked_zones_by_day = {}
    for fromts, zid in booking_rows:
        day = fromts - fromts % (24 * 3600)
        booked_zones_by_day.setdefault(day, set()).add(zid)

    zone_names = {}
    if missing_enabled:
        zone_names = {z[0]: z[1] for z in Zone.select(Zone.id, Zone.name)
                                              .where(Zone.id.in_(reminder_zones))
                                              .tuples()}

    dtstamp = _ts_to_ical_dt(now_ts)

    # Collect (reminder_ts, uid, summary, kind) tuples
    events = []

    for i in range(horizon_days + 1):
        D = today_ts + i * 24 * 3600
        tm = gmtime(D)
        if not (weekdays_mask & (1 << tm.tm_wday)):
            continue

        day_str = strftime("%Y%m%d", tm)
        booked_zids = booked_zones_by_day.get(D, set())

        if missing_enabled:
            reminder_ts = D - ahead_days * 24 * 3600 + reminder_time
            if reminder_ts >= today_ts:
                for zid in reminder_zones:
                    if zid not in booked_zids:
                        uid = f"missing-{zid}-{day_str}@warp"
                        summary = _escape_ical_text(
                            summaries['missing'].format(zone=zone_names.get(zid, str(zid)))
                        )
                        events.append((reminder_ts, uid, summary, 'missing', zid))

        if release_enabled and private_seats:
            for sid, zid, release_days, seat_name in private_seats:
                reminder_ts = D - (release_days + release_ahead_days) * 24 * 3600 + reminder_time
                if reminder_ts >= today_ts and zid not in booked_zids:
                    uid = f"release-{sid}-{day_str}@warp"
                    summary = _escape_ical_text(summaries['release'].format(name=seat_name))
                    events.append((reminder_ts, uid, summary, 'release', zid))

    # When a missing and release event share the same timestamp for the same zone, the release one wins
    release_keys = {(ts, z) for ts, uid, summary, kind, z in events if kind == 'release'}

    lines = []
    for reminder_ts, uid, summary, kind, zid in events:
        if kind == 'missing' and (reminder_ts, zid) in release_keys:
            continue
        dtstart = _ts_to_ical_dt(reminder_ts)
        dtend = _ts_to_ical_dt(reminder_ts + 900)
        lines.append(_format_vevent(uid, dtstamp, dtstart, dtend, summary))

    return lines


@bp.route("/ical/<token>.ics")
def ical_feed(token):
    row = UserPrefs.select(UserPrefs.login) \
        .where((UserPrefs.ical_token == token) & (UserPrefs.ical_enabled == True)) \
        .first()

    if row is None:
        flask.abort(404)

    login = row['login']

    now_ts = utils.now()
    today_ts = utils.today()
    lookback = 7 * 24 * 3600
    min_ts = now_ts - lookback

    bookings = Book.select(Book.id, Book.fromts, Book.tots, Seat.name) \
        .join(Seat, on=(Book.sid == Seat.id)) \
        .where((Book.login == login) & (Book.tots > min_ts)) \
        .order_by(Book.fromts.asc()) \
        .tuples()

    dtstamp = _ts_to_ical_dt(now_ts)
    summaries = _summary_templates()

    lines = [ICAL_HEADER]
    for book_id, fromts, tots, seat_name in bookings:
        lines.append(_format_vevent(
            uid=f"{book_id}@warp",
            dtstamp=dtstamp,
            dtstart=_ts_to_ical_dt(fromts),
            dtend=_ts_to_ical_dt(tots),
            summary=_escape_ical_text(summaries['booking'].format(name=seat_name)),
        ))

    lines.extend(_reminder_vevents(login, now_ts, today_ts, summaries))

    lines.append(ICAL_FOOTER)

    return flask.Response("".join(lines), mimetype="text/calendar")
