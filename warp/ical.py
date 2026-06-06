import flask
import hmac
import hashlib
import os
import secrets
from calendar import timegm
from time import gmtime, strftime, strptime

from peewee import JOIN

from warp import utils
from warp.db import UserPrefs, Book, Seat, SeatAssign, Zone, CalendarCache

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

_ACTION_TRANSLATIONS = {
    'en': {
        'Seat Booked': 'Seat Booked',
        'Seat Already Booked': 'Seat Already Booked',
        'Not possible to book': 'Not possible to book',
        'Requested date is in the past': 'Requested date is in the past',
        'Forbidden': 'Forbidden',
        'Error': 'Error',
        'Seat released': 'Seat released',
        'Reservation in the past': 'Reservation in the past',
    },
    'pl': {
        'Seat Booked': 'Miejsce zarezerwowane',
        'Seat Already Booked': 'Miejsce już zarezerwowane',
        'Not possible to book': 'Rezerwacja niemożliwa',
        'Requested date is in the past': 'Żądana data jest w przeszłości',
        'Forbidden': 'Zabronione',
        'Error': 'Błąd',
        'Seat released': 'Miejsce zwolnione',
        'Reservation in the past': 'Rezerwacja w przeszłości',
    },
    'de': {
        'Seat Booked': 'Platz reserviert',
        'Seat Already Booked': 'Platz bereits reserviert',
        'Not possible to book': 'Reservierung nicht möglich',
        'Requested date is in the past': 'Das gewünschte Datum liegt in der Vergangenheit',
        'Forbidden': 'Verboten',
        'Error': 'Fehler',
        'Seat released': 'Platz freigegeben',
        'Reservation in the past': 'Reservierung in der Vergangenheit',
    },
    'fr': {
        'Seat Booked': 'Place réservée',
        'Seat Already Booked': 'Place déjà réservée',
        'Not possible to book': 'Réservation impossible',
        'Requested date is in the past': 'La date demandée est dans le passé',
        'Forbidden': 'Interdit',
        'Error': 'Erreur',
        'Seat released': 'Place libérée',
        'Reservation in the past': 'Réservation dans le passé',
    },
    'es': {
        'Seat Booked': 'Asiento reservado',
        'Seat Already Booked': 'Asiento ya reservado',
        'Not possible to book': 'No es posible reservar',
        'Requested date is in the past': 'La fecha solicitada está en el pasado',
        'Forbidden': 'Prohibido',
        'Error': 'Error',
        'Seat released': 'Asiento liberado',
        'Reservation in the past': 'Reserva en el pasado',
    },
}


def _summary_templates():
    lang_file = flask.current_app.config.get('LANGUAGE_FILE', '')
    locale = os.path.splitext(os.path.basename(lang_file))[0]
    return _SUMMARY_TRANSLATIONS.get(locale, _SUMMARY_TRANSLATIONS['en'])


def _action_templates():
    lang_file = flask.current_app.config.get('LANGUAGE_FILE', '')
    locale = os.path.splitext(os.path.basename(lang_file))[0]
    return _ACTION_TRANSLATIONS.get(locale, _ACTION_TRANSLATIONS['en'])


def _action_t(key):
    return _action_templates().get(key, key)


def _render_action(title, details=None, status=200):
    return flask.render_template('ical_action.html', title=title, details=details), status


def _ts_to_ical_dt(ts):
    return strftime("%Y%m%dT%H%M%SZ", gmtime(ts))


def _escape_ical_text(text):
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _format_vevent(uid, dtstamp, dtstart, dtend, summary, url=None, description=None):
    parts = ["BEGIN:VEVENT\r\n",
             f"UID:{uid}\r\n",
             f"DTSTAMP:{dtstamp}\r\n",
             f"DTSTART:{dtstart}\r\n",
             f"DTEND:{dtend}\r\n",
             f"SUMMARY:{summary}\r\n"]
    if url:
        parts.append(f"URL:{url}\r\n")
    if description:
        parts.append(f"DESCRIPTION:{description}\r\n")
    parts.append("END:VEVENT\r\n")
    return "".join(parts)


# ---------------------------------------------------------------------------
# HMAC token helpers
# ---------------------------------------------------------------------------

def _compute_hmac(ical_token, *parts):
    msg = '|'.join(str(p) for p in parts)
    return hmac.new(ical_token.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).hexdigest()[:32]


def booking_token(ical_token, zid, date_str, nonce):
    """HMAC token authorising one auto-book action link."""
    return _compute_hmac(ical_token, 'book', zid, date_str, nonce)


def delete_token(ical_token, rid, nonce):
    """HMAC token authorising one release-booking action link."""
    return _compute_hmac(ical_token, 'delete', rid, nonce)


# ---------------------------------------------------------------------------
# Cache invalidation (called by zone.apply / zone.autoBook / calendar_post)
# ---------------------------------------------------------------------------

def invalidate_calendar_cache(logins):
    """Delete calendar_cache rows for the given login(s)."""
    if isinstance(logins, str):
        logins = [logins]
    logins = list(logins)
    if logins:
        CalendarCache.delete().where(CalendarCache.login.in_(logins)).execute()


# ---------------------------------------------------------------------------
# iCal generation helpers
# ---------------------------------------------------------------------------

def _reminder_vevents(login, ical_token, now_ts, today_ts, summaries):
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

    # Collect (reminder_ts, uid, summary, kind, zid, action_day_str) tuples
    events = []

    for i in range(horizon_days + 1):
        D = today_ts + i * 24 * 3600
        tm = gmtime(D)
        if not (weekdays_mask & (1 << tm.tm_wday)):
            continue

        day_str = strftime("%Y%m%d", tm)
        action_day_str = strftime("%Y-%m-%d", tm)
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
                        events.append((reminder_ts, uid, summary, 'missing', zid, action_day_str))

        if release_enabled and private_seats:
            for sid, zid, release_days, seat_name in private_seats:
                reminder_ts = D - (release_days + release_ahead_days) * 24 * 3600 + reminder_time
                if reminder_ts >= today_ts and zid not in booked_zids:
                    uid = f"release-{sid}-{day_str}@warp"
                    summary = _escape_ical_text(summaries['release'].format(name=seat_name))
                    events.append((reminder_ts, uid, summary, 'release', zid, action_day_str))

    # When a missing and release event share the same timestamp for the same zone, the release one wins
    release_keys = {(ts, z) for ts, uid, summary, kind, z, _d in events if kind == 'release'}

    lines = []
    for reminder_ts, uid, summary, kind, zid, action_day_str in events:
        if kind == 'missing' and (reminder_ts, zid) in release_keys:
            continue
        dtstart = _ts_to_ical_dt(reminder_ts)
        dtend = _ts_to_ical_dt(reminder_ts + 900)

        url = None
        description = None
        if kind == 'missing' and ical_token:
            nonce = secrets.token_hex(8)
            tok = booking_token(ical_token, zid, action_day_str, nonce)
            url = flask.url_for(
                'ical.book_seat', login=login,
                z=zid, d=action_day_str, n=nonce, t=tok,
                _external=True,
            )
            description = summary  # reuse summary text as description

        lines.append(_format_vevent(uid, dtstamp, dtstart, dtend, summary,
                                    url=url, description=description))

    return lines


def _generate_ical(login, ical_token, now_ts, today_ts):
    """Build and return the full iCalendar text for `login`."""
    lookback = 7 * 24 * 3600
    min_ts = now_ts - lookback

    bookings = (Book.select(Book.id, Book.fromts, Book.tots, Seat.name)
                    .join(Seat, on=(Book.sid == Seat.id))
                    .where((Book.login == login) & (Book.tots > min_ts))
                    .order_by(Book.fromts.asc())
                    .tuples())

    dtstamp = _ts_to_ical_dt(now_ts)
    summaries = _summary_templates()

    lines = [ICAL_HEADER]
    for book_id, fromts, tots, seat_name in bookings:
        nonce = secrets.token_hex(8)
        tok = delete_token(ical_token, book_id, nonce)
        del_url = flask.url_for(
            'ical.delete_seat', login=login,
            i=book_id, n=nonce, t=tok,
            _external=True,
        )
        lines.append(_format_vevent(
            uid=f"{book_id}@warp",
            dtstamp=dtstamp,
            dtstart=_ts_to_ical_dt(fromts),
            dtend=_ts_to_ical_dt(tots),
            summary=_escape_ical_text(summaries['booking'].format(name=seat_name)),
            url=del_url,
            description=_escape_ical_text(summaries['booking'].format(name=seat_name)),
        ))

    lines.extend(_reminder_vevents(login, ical_token, now_ts, today_ts, summaries))

    lines.append(ICAL_FOOTER)
    return "".join(lines)


# ---------------------------------------------------------------------------
# iCal feed endpoint
# ---------------------------------------------------------------------------

@bp.route("/calendar/<login>/events.ics")
def ical_feed(login):
    t = flask.request.args.get('t')
    if not t:
        flask.abort(404)

    today_ts = utils.today()
    now_ts = utils.now()

    # Single query: validate token + check cache
    row = (UserPrefs.select(
               UserPrefs.login,
               CalendarCache.ics,
               CalendarCache.day,
           )
           .join(CalendarCache, JOIN.LEFT_OUTER, on=(UserPrefs.login == CalendarCache.login))
           .where(
               (UserPrefs.login == login) &
               (UserPrefs.ical_token == t) &
               (UserPrefs.ical_enabled == True)
           )
           .first())

    if row is None:
        flask.abort(404)

    # Cache hit: same calendar day, reuse stored ICS
    if row['ics'] is not None and row['day'] == today_ts:
        return flask.Response(row['ics'], mimetype="text/calendar")

    # Cache miss: regenerate
    ics_content = _generate_ical(login, t, now_ts, today_ts)

    CalendarCache.insert({
        CalendarCache.login: login,
        CalendarCache.ics: ics_content,
        CalendarCache.day: today_ts,
        CalendarCache.generated_at: now_ts,
    }).on_conflict(
        conflict_target=[CalendarCache.login],
        update={
            CalendarCache.ics: ics_content,
            CalendarCache.day: today_ts,
            CalendarCache.generated_at: now_ts,
        }
    ).execute()

    return flask.Response(ics_content, mimetype="text/calendar")


# ---------------------------------------------------------------------------
# Action endpoints: book a seat / release a seat via iCal link
# ---------------------------------------------------------------------------

@bp.route("/calendar/<login>/book")
def book_seat(login):
    z = flask.request.args.get('z')
    d = flask.request.args.get('d')
    n = flask.request.args.get('n')
    t = flask.request.args.get('t')

    if not (z and d and n and t):
        return _render_action(_action_t('Error'), status=400)

    try:
        zid = int(z)
    except (ValueError, TypeError):
        return _render_action(_action_t('Error'), status=400)

    # Validate user and token
    up = (UserPrefs.select(UserPrefs.ical_token, UserPrefs.ical_enabled)
                   .where(UserPrefs.login == login)
                   .first())
    if up is None or not up['ical_enabled'] or not up['ical_token']:
        return _render_action(_action_t('Forbidden'), status=403)

    ical_token = up['ical_token']
    expected = booking_token(ical_token, zid, d, n)
    if not hmac.compare_digest(expected, t):
        return _render_action(_action_t('Forbidden'), status=403)

    # Parse date
    try:
        day_ts = timegm(strptime(d, "%Y-%m-%d"))
    except (ValueError, OverflowError):
        return _render_action(_action_t('Error'), status=400)

    if day_ts < utils.today():
        return _render_action(_action_t('Requested date is in the past'))

    # Zone role check
    zone_row = (Zone.select(Zone.zone_type, Zone.zone_group, Zone.name)
                    .where(Zone.id == zid)
                    .first())
    if zone_row is None:
        return _render_action(_action_t('Not possible to book'))

    from warp.db import UserToZoneRoles, effectiveZoneRole, ZONE_ROLE_USER
    specific_role = (UserToZoneRoles.select(UserToZoneRoles.zone_role)
                                    .where((UserToZoneRoles.zid == zid) &
                                           (UserToZoneRoles.login == login))
                                    .scalar())
    effective_role = effectiveZoneRole(zone_row['zone_type'], specific_role)
    if effective_role is None or effective_role > ZONE_ROLE_USER:
        return _render_action(_action_t('Forbidden'), status=403)

    # Compute booking slot from user's default time preferences
    from warp.xhr.prefs import get_user_prefs
    prefs = get_user_prefs(login)
    time_from, time_to = prefs['default_time']
    slot = {'fromTS': day_ts + time_from, 'toTS': day_ts + time_to}

    # Pre-check: any existing booking in the same zone_group that overlaps the day
    zone_group = zone_row['zone_group']
    day_end = day_ts + 86400
    existing = (Book.select(Book.id, Book.fromts, Book.tots,
                            Seat.name.alias('seat_name'),
                            Zone.name.alias('zone_name'))
                    .join(Seat, on=(Book.sid == Seat.id))
                    .join(Zone, on=(Seat.zid == Zone.id))
                    .where(Book.login == login)
                    .where(Zone.zone_group == zone_group)
                    .where(Book.fromts < day_end)
                    .where(Book.tots > day_ts)
                    .first())
    if existing is not None:
        details = "{zone} – {seat} – {timespan}".format(
            zone=existing['zone_name'],
            seat=existing['seat_name'],
            timespan=utils.formatTimespan(existing['fromts'], existing['tots']),
        )
        return _render_action(_action_t('Seat Already Booked'), details=details)

    # Run autobook
    from warp.xhr.zone import runAutoBook
    result, err = runAutoBook(login, zid, [slot])

    if err == 103:
        return _render_action(_action_t('Not possible to book'))
    if err is not None:
        return _render_action(_action_t('Not possible to book'))

    booked = result.get('booked', [])
    if booked:
        invalidate_calendar_cache(login)
        item = booked[0]
        zone_name = zone_row['name']
        details = "{zone} – {seat} – {timespan}".format(
            zone=zone_name,
            seat=item['seat_name'],
            timespan=utils.formatTimespan(item['fromTS'], item['toTS']),
        )
        return _render_action(_action_t('Seat Booked'), details=details)

    return _render_action(_action_t('Not possible to book'))


@bp.route("/calendar/<login>/delete")
def delete_seat(login):
    i = flask.request.args.get('i')
    n = flask.request.args.get('n')
    t = flask.request.args.get('t')

    if not (i and n and t):
        return _render_action(_action_t('Error'), status=400)

    try:
        rid = int(i)
    except (ValueError, TypeError):
        return _render_action(_action_t('Error'), status=400)

    # Validate user and token
    up = (UserPrefs.select(UserPrefs.ical_token, UserPrefs.ical_enabled)
                   .where(UserPrefs.login == login)
                   .first())
    if up is None or not up['ical_enabled'] or not up['ical_token']:
        return _render_action(_action_t('Forbidden'), status=403)

    ical_token = up['ical_token']
    expected = delete_token(ical_token, rid, n)
    if not hmac.compare_digest(expected, t):
        return _render_action(_action_t('Forbidden'), status=403)

    # Find the booking (must belong to this login)
    book = (Book.select(Book.id, Book.fromts, Seat.name.alias('seat_name'))
                .join(Seat, on=(Book.sid == Seat.id))
                .where((Book.id == rid) & (Book.login == login))
                .first())
    if book is None:
        return _render_action(_action_t('Error'), status=404)

    if book['fromts'] < utils.today():
        return _render_action(_action_t('Reservation in the past'))

    seat_name = book['seat_name']
    Book.delete().where(Book.id == rid).execute()
    invalidate_calendar_cache(login)

    return _render_action(_action_t('Seat released'), details=seat_name)
