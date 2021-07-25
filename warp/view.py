import flask
from werkzeug.utils import redirect
from .db import getDB
from . import auth
from . import utils
from time import strftime

bp = flask.Blueprint('view', __name__)

@bp.before_request
def headerData():

    headerData = []

    if flask.session.get('role') <= auth.ROLE_MANAGER:
        headerData.append(
            {"text": "All bookings", "endpoint": "view.bookings", "view_args": {"context":"all"} })
    
    headerData.append(
        {"text": "My bookings", "endpoint": "view.bookings", "view_args": {"context":"user"} })

    zones = getDB().cursor().execute("SELECT id,name FROM zone")
    for z in zones:
        headerData.append(
            {"text": z['name'], "endpoint": "view.zone", "view_args": {"zid":str(z['id'])} })

    #generate urls and selected
    for h in headerData:

        h['url'] = flask.url_for(h['endpoint'],**h['view_args'])
        a = flask.request.endpoint == h['endpoint']
        b = flask.request.view_args == h['view_args']
        h['active'] = flask.request.endpoint == h['endpoint'] and flask.request.view_args == h['view_args']

    flask.g.headerData = headerData


@bp.route("/")
def index():
    return flask.render_template('index.html')

@bp.route("/bookings/<context>")
def bookings(context):

    if context != 'all' and context != 'user':
        flask.abort(404)

    if context == 'all' and flask.session.get('role') > auth.ROLE_MANAGER:
        flask.abort(403)

    uid = flask.session.get('uid')
    
    timeRange = utils.getTimeRange()

    query = "SELECT b.id, b.fromTS, b.toTS, s.name seat_name, z.name zone_name, u.login login FROM book b" \
            " LEFT JOIN seat s ON s.id = b.sid" \
            " LEFT JOIN zone z ON z.id = s.zid" \
            " LEFT JOIN user u ON b.uid = u.id" \
            " WHERE b.toTS > ?" \
            " AND (? OR uid = ?)" \
            " ORDER BY b.fromTS, login"
    
    data = getDB().cursor().execute(query,(timeRange['fromTS'], context == 'all', uid)).fetchall()

    return flask.render_template('bookings.html', context=context, data=data, formatTimestamp=utils.formatTimestamp)

@bp.route("/zone/<zid>")
def zone(zid):

    row = getDB().cursor().execute("SELECT * FROM zone WHERE id = ?",(zid,)).fetchone()

    if row is None:
        flask.abort(404)

    nextWeek = utils.getNextWeek()
    for d in nextWeek[1:]:
        if not d['isWeekend']:
            d['mark'] = True
            break

    return flask.render_template('zone.html',zone_data=row, nextWeek=nextWeek)
