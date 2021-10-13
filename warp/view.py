import flask
import peewee
from . import auth
from . import utils

from warp.db import *

bp = flask.Blueprint('view', __name__)

@bp.context_processor
def headerDataInit():

    headerDataL = []

    headerDataL.append(
        {"text": "Bookings", "endpoint": "view.bookings", "view_args": {} })

    zoneCursor = Zone.select(Zone.id, Zone.name) \
                     .where( Zone.id.in_( ZoneAssign.select(ZoneAssign.zid).where(ZoneAssign.login.in_(flask.g.groups)) ) )

    for z in zoneCursor:
        headerDataL.append(
            {"text": z['name'], "endpoint": "view.zone", "view_args": {"zid":str(z['id'])} })

    headerDataR = [
        {"text": "Report", "endpoint": "view.report", "view_args": {} },
        {"text": "Users", "endpoint": "view.users", "view_args": {} }
    ]

    #generate urls and selected
    for hdata in [headerDataL,headerDataR]:

        for h in hdata:

            h['url'] = flask.url_for(h['endpoint'],**h['view_args'])
            a = flask.request.endpoint == h['endpoint']
            b = flask.request.view_args == h['view_args']
            h['active'] = flask.request.endpoint == h['endpoint'] and flask.request.view_args == h['view_args']


    return { "headerDataL": headerDataL,
             "headerDataR": headerDataR,
             'hasLogout': 'auth.logout' in flask.current_app.view_functions
    }

@bp.route("/")
def index():
    return flask.render_template('index.html')

@bp.route("/bookings")
def bookings():

    return flask.render_template('bookings.html',report=False)

@bp.route("/report")
def report():

    if not flask.g.isAdmin:
        flask.abort(403)

    return flask.render_template('bookings.html',report=True)


@bp.route("/users")
def users():

    if not flask.g.isAdmin:
        flask.abort(403)

    return flask.render_template('users.html')

@bp.route("/zone/<zid>")
def zone(zid):

    zoneRole = ZoneAssign.select(peewee.fn.MIN(ZoneAssign.zone_role) ) \
                                .where(ZoneAssign.zid == zid) \
                                .where(ZoneAssign.login.in_(flask.g.groups)) \
                                .group_by(ZoneAssign.zid).scalar()

    if zoneRole is None:
        flask.abort(403)

    zoneMapImage = Zone.select(Zone.image) \
                         .where(Zone.id == zid).scalar()

    if zoneMapImage is None:
        flask.abort(404)

    nextWeek = utils.getNextWeek()
    defaultSelectedDates = {
        "slider": [9*3600, 17*3600]
    }

    for d in nextWeek[1:]:
        if not d['isWeekend']:
            defaultSelectedDates['cb'] = [d['timestamp']]
            break

    if zoneRole <= ZONE_ROLE_ADMIN:
        zoneRole = {'isZoneAdmin': True}
    elif zoneRole <= ZONE_ROLE_USER:
        zoneRole = {}
    elif zoneRole <= ZONE_ROLE_VIEWER:
        zoneRole = {'isZoneViewer': True}
    else:
        raise Exception('Undefined role')


    return flask.render_template('zone.html',
        zoneMapImage=zoneMapImage,
        **zoneRole,
        zoneId = zid,
        nextWeek=nextWeek,
        defaultSelectedDates=defaultSelectedDates)
