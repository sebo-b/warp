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
    
    headerData.append(
        {"text": "Bookings", "endpoint": "view.bookings", "view_args": {} })

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
             "isManager": flask.session.get('role') <= auth.ROLE_MANAGER,
             'hasLogout': 'auth.logout' in flask.current_app.view_functions
    }

@bp.route("/")
def index():
    return flask.render_template('index.html')

@bp.route("/bookings")
def bookings():

    return flask.render_template('bookings.html')

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
