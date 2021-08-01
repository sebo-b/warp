import flask
from werkzeug.utils import redirect
from .db import getDB
from . import auth
from . import utils
from time import strftime

bp = flask.Blueprint('view', __name__)

@bp.context_processor
def headerDataInit():

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

    return { "headerData": headerData,
             "isManager": flask.session.get('role') <= auth.ROLE_MANAGER
    }

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
    
    timeRange = utils.getTimeRange(True)


    query = "SELECT b.id, b.fromTS, b.toTS, s.name seat_name, z.name zone_name, u.login login FROM book b" \
            " JOIN seat s ON s.id = b.sid" \
            " JOIN zone z ON z.id = s.zid" \
            " JOIN user u ON b.uid = u.id" \
            " WHERE b.toTS > ? AND b.fromTS < ?" \
            " AND (? OR uid = ?)" \
            " ORDER BY b.fromTS, login"
    
    data = getDB().cursor().execute(query,(
                                        timeRange['fromTS'], 
                                        timeRange['toTS'], 
                                        context == 'all', 
                                        uid)
                                        ).fetchall()

    return flask.render_template('bookings.html', context=context, data=data, formatTimestamp=utils.formatTimestamp)

@bp.route("/zone/<zid>")
def zone(zid):

    row = getDB().cursor().execute("SELECT id,name,image FROM zone")

    zone_data = {
        "names": {}
    }

    for z in row:
        zone_data["names"][z['id']] = z['name']

        if z['id'] == int(zid):
            zone_data['id'] = zid
            zone_data['image'] = z['image']

    if "id" not in zone_data:
        flask.abort(404)

    nextWeek = utils.getNextWeek()
    defaultSelections = {
        "slider": [9*3600, 17*3600]
    }

    for d in nextWeek[1:]:
        if not d['isWeekend']:
            defaultSelections['cb'] = [d['timestamp']]
            break

    return flask.render_template('zone.html',zone_data=zone_data, nextWeek=nextWeek, defaultSelections=defaultSelections)
