import flask
import functools
import hmac
import hashlib
import json
import os
import secrets
from calendar import timegm
from time import gmtime, strftime, strptime

from warp import utils
from warp.db import UserPrefs, Book, Seat, SeatAssign, Zone, Plan, CalendarCache

bp = flask.Blueprint('ical', __name__)

ICAL_HEADER = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Warp//Seat Booking//EN\r\n"
ICAL_FOOTER = "END:VCALENDAR\r\n"

ICAL_TYPE_BOOKINGS = 'bookings'
ICAL_TYPE_REMINDERS = 'reminders'
ICAL_TYPE_ALL = 'all'
ICAL_TYPES = (ICAL_TYPE_BOOKINGS, ICAL_TYPE_REMINDERS, ICAL_TYPE_ALL)


# ---------------------------------------------------------------------------
# i18n: server-side phrases loaded from the deployment language JSON file
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=8)
def _load_phrases_from_file(json_path):
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('phrases', {}).get('ical', {})
    except (OSError, json.JSONDecodeError):
        return {}


def _ical_phrases():
    lang_file = flask.current_app.config.get('LANGUAGE_FILE', '')
    static = flask.current_app.static_folder
    phrases = _load_phrases_from_file(os.path.join(static, lang_file))
    if not phrases:
        phrases = _load_phrases_from_file(os.path.join(static, 'i18n/en.json'))
    return phrases


def _action_t(key):
    return _ical_phrases().get(key, key)


def _render_action(title, details=None, status=200):
    return flask.render_template('ical_action.html', title=title, details=details), status


def _render_confirm(title, details, confirm_url, cancel_url, status=200):
    return flask.render_template(
        'ical_confirm.html',
        title=title, details=details,
        confirm_url=confirm_url, cancel_url=cancel_url,
        confirm_label=_action_t('Confirm'),
        cancel_label=_action_t('Cancel'),
    ), status


# ---------------------------------------------------------------------------
# iCal formatting helpers
# ---------------------------------------------------------------------------

def _ts_to_ical_dt(ts, tz=None):
    if tz:
        return strftime("%Y%m%dT%H%M%S", gmtime(ts))
    return strftime("%Y%m%dT%H%M%SZ", gmtime(ts))


def _escape_ical_text(text):
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _format_vevent(uid, dtstamp, dtstart, dtend, summary, url=None, description=None, tz=None):
    tzid = f";TZID={tz}" if tz else ""
    parts = ["BEGIN:VEVENT\r\n",
             f"UID:{uid}\r\n",
             f"DTSTAMP:{dtstamp}\r\n",
             f"DTSTART{tzid}:{dtstart}\r\n",
             f"DTEND{tzid}:{dtend}\r\n",
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


def confirm_delete_token(ical_token, rid, nonce):
    """HMAC token authorising the confirmed release action."""
    return _compute_hmac(ical_token, 'delete_confirmed', rid, nonce)


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
# VEVENT generators
# ---------------------------------------------------------------------------

def _generate_bookings_vevents(login, ical_token, now_ts, phrases, tz=None):
    """Return list of VEVENT strings for seat booking events."""
    lookback = 7 * 24 * 3600
    min_ts = now_ts - lookback
    dtstamp = _ts_to_ical_dt(now_ts)

    bookings = (Book.select(Book.id, Book.fromts, Book.tots, Seat.name)
                    .join(Seat, on=(Book.sid == Seat.id))
                    .where((Book.login == login) & (Book.tots > min_ts))
                    .order_by(Book.fromts.asc())
                    .tuples())

    lines = []
    for book_id, fromts, tots, seat_name in bookings:
        nonce = secrets.token_hex(8)
        tok = delete_token(ical_token, book_id, nonce)
        del_url = flask.url_for(
            'ical.delete_seat', login=login,
            i=book_id, n=nonce, t=tok,
            _external=True,
        )
        url_escaped = _escape_ical_text(del_url)
        lines.append(_format_vevent(
            uid=f"{book_id}@warp",
            dtstamp=dtstamp,
            dtstart=_ts_to_ical_dt(fromts, tz),
            dtend=_ts_to_ical_dt(tots, tz),
            summary=_escape_ical_text(phrases['booking'].format(name=seat_name)),
            url=del_url,
            description=_escape_ical_text(phrases['booking_desc']).replace('{url}', url_escaped),
            tz=tz,
        ))
    return lines


def _generate_reminders_vevents(login, ical_token, now_ts, today_ts, phrases, tz=None):
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

    if not reminder_zones or (not missing_enabled and not release_enabled):
        return []

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
                            phrases['missing'].format(zone=zone_names.get(zid, str(zid)))
                        )
                        events.append((reminder_ts, uid, summary, 'missing', zid, action_day_str))

        if release_enabled and private_seats:
            for sid, zid, release_days, seat_name in private_seats:
                reminder_ts = D - (release_days + release_ahead_days) * 24 * 3600 + reminder_time
                if reminder_ts >= today_ts and zid not in booked_zids:
                    uid = f"release-{sid}-{day_str}@warp"
                    summary = _escape_ical_text(phrases['release'].format(name=seat_name))
                    events.append((reminder_ts, uid, summary, 'release', zid, action_day_str))

    # When missing and release share the same (ts, zone), release wins
    release_keys = {(ts, z) for ts, uid, summary, kind, z, _d in events if kind == 'release'}

    lines = []
    for reminder_ts, uid, summary, kind, zid, action_day_str in events:
        if kind == 'missing' and (reminder_ts, zid) in release_keys:
            continue
        dtstart = _ts_to_ical_dt(reminder_ts, tz)
        dtend = _ts_to_ical_dt(reminder_ts + 900, tz)

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
            url_escaped = _escape_ical_text(url)
            description = _escape_ical_text(phrases['missing_desc']).replace('{url}', url_escaped)

        lines.append(_format_vevent(uid, dtstamp, dtstart, dtend, summary,
                                    url=url, description=description, tz=tz))

    return lines


# ---------------------------------------------------------------------------
# Cache-aware content assembly
# ---------------------------------------------------------------------------

def _strip_calendar_wrapper(ics):
    """Extract the VEVENT block(s) from a complete ICS string."""
    start = ics.find('BEGIN:VEVENT')
    if start == -1:
        return ''
    end = ics.rfind('END:VEVENT\r\n')
    if end == -1:
        return ''
    return ics[start:end + len('END:VEVENT\r\n')]


def _get_or_cache(login, ical_token, now_ts, today_ts, type_):
    """Return a full ICS string for one type (bookings or reminders), using/updating cache."""
    row = (CalendarCache.select(CalendarCache.ics, CalendarCache.day)
                        .where((CalendarCache.login == login) &
                               (CalendarCache.type == type_))
                        .first())

    if row is not None and row['day'] == today_ts:
        return row['ics']

    tz = flask.current_app.config.get('TIMEZONE') or None
    phrases = _ical_phrases()

    if type_ == ICAL_TYPE_BOOKINGS:
        vevents = _generate_bookings_vevents(login, ical_token, now_ts, phrases, tz)
    else:
        vevents = _generate_reminders_vevents(login, ical_token, now_ts, today_ts, phrases, tz)

    ics = ICAL_HEADER + ''.join(vevents) + ICAL_FOOTER

    CalendarCache.insert({
        CalendarCache.login: login,
        CalendarCache.type: type_,
        CalendarCache.ics: ics,
        CalendarCache.day: today_ts,
        CalendarCache.generated_at: now_ts,
    }).on_conflict(
        conflict_target=[CalendarCache.login, CalendarCache.type],
        update={
            CalendarCache.ics: ics,
            CalendarCache.day: today_ts,
            CalendarCache.generated_at: now_ts,
        }
    ).execute()

    return ics


def get_ical_content(login, ical_token, now_ts, today_ts, type_=ICAL_TYPE_ALL):
    """Return complete ICS text for the requested type."""
    if type_ not in ICAL_TYPES:
        type_ = ICAL_TYPE_ALL

    if type_ in (ICAL_TYPE_BOOKINGS, ICAL_TYPE_REMINDERS):
        return _get_or_cache(login, ical_token, now_ts, today_ts, type_)

    bookings_ics = _get_or_cache(login, ical_token, now_ts, today_ts, ICAL_TYPE_BOOKINGS)
    reminders_ics = _get_or_cache(login, ical_token, now_ts, today_ts, ICAL_TYPE_REMINDERS)
    return ICAL_HEADER + _strip_calendar_wrapper(bookings_ics) + _strip_calendar_wrapper(reminders_ics) + ICAL_FOOTER


# ---------------------------------------------------------------------------
# iCal feed endpoint
# ---------------------------------------------------------------------------

@bp.route("/calendar/<login>/events.ics")
def ical_feed(login):
    t = flask.request.args.get('t')
    if not t:
        flask.abort(404)

    requested_type = (flask.request.args.get('type') or ICAL_TYPE_ALL).lower()
    if requested_type not in ICAL_TYPES:
        requested_type = ICAL_TYPE_ALL

    today_ts = utils.today()
    now_ts = utils.now()

    row = (UserPrefs.select(UserPrefs.login)
                    .where(
                        (UserPrefs.login == login) &
                        (UserPrefs.ical_token == t) &
                        (UserPrefs.ical_enabled == True)
                    )
                    .first())

    if row is None:
        flask.abort(404)

    ics_content = get_ical_content(login, t, now_ts, today_ts, type_=requested_type)
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

    up = (UserPrefs.select(UserPrefs.ical_token, UserPrefs.ical_enabled)
                   .where(UserPrefs.login == login)
                   .first())
    if up is None or not up['ical_enabled'] or not up['ical_token']:
        return _render_action(_action_t('Forbidden'), status=403)

    ical_token = up['ical_token']
    expected = booking_token(ical_token, zid, d, n)
    if not hmac.compare_digest(expected, t):
        return _render_action(_action_t('Forbidden'), status=403)

    try:
        day_ts = timegm(strptime(d, "%Y-%m-%d"))
    except (ValueError, OverflowError):
        return _render_action(_action_t('Error'), status=400)

    if day_ts < utils.today():
        return _render_action(_action_t('Requested date is in the past'))

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

    from warp.xhr.prefs import get_user_prefs
    prefs = get_user_prefs(login)
    time_from, time_to = prefs['default_time']
    slot = {'fromTS': day_ts + time_from, 'toTS': day_ts + time_to}

    zone_grp = zone_row['zone_group']
    day_end = day_ts + 86400
    existing_q = (Book.select(Book.id, Book.fromts, Book.tots,
                              Seat.name.alias('seat_name'),
                              Zone.name.alias('zone_name'))
                      .join(Seat, on=(Book.sid == Seat.id))
                      .join(Zone, on=(Seat.zid == Zone.id))
                      .where(Book.login == login)
                      .where(Book.fromts < day_end)
                      .where(Book.tots > day_ts))
    if zone_grp is not None:
        existing_q = existing_q.where(Zone.zone_group == zone_grp)
    else:
        existing_q = existing_q.where(Seat.zid == zid)
    existing = existing_q.first()
    if existing is not None:
        details = "{zone} – {seat} – {timespan}".format(
            zone=existing['zone_name'],
            seat=existing['seat_name'],
            timespan=utils.formatTimespan(existing['fromts'], existing['tots']),
        )
        return _render_action(_action_t('Seat Already Booked'), details=details)

    plan_row = (Plan.select(Plan.id)
                    .join(Seat, on=(Seat.pid == Plan.id))
                    .where(Seat.zid == zid)
                    .first())
    if plan_row is None:
        return _render_action(_action_t('Not possible to book'))
    pid = plan_row['id']

    from warp.xhr.zone import runAutoBook
    result, err = runAutoBook(login, pid, [slot], allowedZids={zid})

    if err is not None:
        return _render_action(_action_t('Not possible to book'))

    booked = result.get('booked', [])
    if booked:
        invalidate_calendar_cache(login)
        item = booked[0]
        details = "{zone} – {seat} – {timespan}".format(
            zone=zone_row['name'],
            seat=item['seat_name'],
            timespan=utils.formatTimespan(item['fromTS'], item['toTS']),
        )
        return _render_action(_action_t('Seat Booked'), details=details)

    return _render_action(_action_t('Not possible to book'))


@bp.route("/calendar/<login>/delete")
def delete_seat(login):
    confirmed = flask.request.args.get('confirmed')

    i = flask.request.args.get('i')
    n = flask.request.args.get('n')
    t = flask.request.args.get('t')

    if not (i and n and t):
        return _render_action(_action_t('Error'), status=400)

    try:
        rid = int(i)
    except (ValueError, TypeError):
        return _render_action(_action_t('Error'), status=400)

    up = (UserPrefs.select(UserPrefs.ical_token, UserPrefs.ical_enabled)
                   .where(UserPrefs.login == login)
                   .first())
    if up is None or not up['ical_enabled'] or not up['ical_token']:
        return _render_action(_action_t('Forbidden'), status=403)

    ical_token = up['ical_token']

    if confirmed is not None:
        expected = confirm_delete_token(ical_token, rid, n)
    else:
        expected = delete_token(ical_token, rid, n)

    if not hmac.compare_digest(expected, t):
        return _render_action(_action_t('Forbidden'), status=403)

    book = (Book.select(Book.id, Book.fromts, Seat.name.alias('seat_name'))
                .join(Seat, on=(Book.sid == Seat.id))
                .where((Book.id == rid) & (Book.login == login))
                .first())
    if book is None:
        return _render_action(_action_t('Error'), status=404)

    if book['fromts'] < utils.today():
        return _render_action(_action_t('Reservation in the past'))

    seat_name = book['seat_name']

    if confirmed is not None:
        Book.delete().where(Book.id == rid).execute()
        invalidate_calendar_cache(login)
        return _render_action(_action_t('Seat released'), details=seat_name)

    nonce2 = secrets.token_hex(8)
    tok2 = confirm_delete_token(ical_token, rid, nonce2)

    confirm_url = flask.url_for(
        'ical.delete_seat', login=login,
        i=rid, n=nonce2, t=tok2, confirmed=1,
    )
    cancel_url = flask.url_for('ical.cancelled')

    return _render_confirm(
        _action_t('Release seat?'),
        seat_name,
        confirm_url,
        cancel_url,
    )


@bp.route("/calendar/cancelled")
def cancelled():
    return _render_action(_action_t('Action cancelled'))
