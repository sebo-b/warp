import flask
import uuid
from time import gmtime, strftime
from warp import utils

from warp.db import UserPrefs, Book, Seat

bp = flask.Blueprint('ical', __name__)

ICAL_HEADER = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Warp//Seat Booking//EN\r\n"
ICAL_FOOTER = "END:VCALENDAR\r\n"

def _ts_to_ical_dt(ts):
    return strftime("%Y%m%dT%H%M%SZ", gmtime(ts))

def _escape_ical_text(text):
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@bp.route("/ical/<token>.ics")
def ical_feed(token):
    row = UserPrefs.select(UserPrefs.login) \
        .where((UserPrefs.ical_token == token) & (UserPrefs.ical_enabled == True)) \
        .first()

    if row is None:
        flask.abort(404)

    login = row['login']

    now_ts = utils.now()
    lookback = 7 * 24 * 3600
    min_ts = now_ts - lookback

    bookings = Book.select(Book.id, Book.fromts, Book.tots, Seat.name) \
        .join(Seat, on=(Book.sid == Seat.id)) \
        .where((Book.login == login) & (Book.tots > min_ts)) \
        .order_by(Book.fromts.asc()) \
        .tuples()

    lines = [ICAL_HEADER]
    for book_id, fromts, tots, seat_name in bookings:
        summary = _escape_ical_text(f"Seat {seat_name}")
        uid = f"{book_id}@warp"
        dtstart = _ts_to_ical_dt(fromts)
        dtend = _ts_to_ical_dt(tots)
        dtstamp = _ts_to_ical_dt(now_ts)

        lines.append("BEGIN:VEVENT\r\n")
        lines.append(f"UID:{uid}\r\n")
        lines.append(f"DTSTAMP:{dtstamp}\r\n")
        lines.append(f"DTSTART:{dtstart}\r\n")
        lines.append(f"DTEND:{dtend}\r\n")
        lines.append(f"SUMMARY:{summary}\r\n")
        lines.append("END:VEVENT\r\n")

    lines.append(ICAL_FOOTER)

    return flask.Response("".join(lines), mimetype="text/calendar")
