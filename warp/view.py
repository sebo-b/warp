import flask
import peewee

from warp.db import UserToZoneRoles
from . import auth
from . import utils

from warp.db import *

bp = flask.Blueprint('view', __name__)

@bp.context_processor
def headerDataInit():

    headerDataL = []

    zoneCursor = Zone.select(Zone.id, Zone.name) \
                     .join(UserToZoneRoles, on=(Zone.id == UserToZoneRoles.zid)) \
                     .where(UserToZoneRoles.login == flask.g.login) \
                     .order_by(Zone.name)

    for z in zoneCursor:
        headerDataL.append(
            {"text": z['name'], "endpoint": "view.zone", "view_args": {"zid":str(z['id'])} })

    if headerDataL:
        headerDataL.insert(0,{"text": "Bookings", "endpoint": "view.bookings", "view_args": {} })

    headerDataR = [
        {"text": "Report", "endpoint": "view.report", "view_args": {} },
        {"text": "Users", "endpoint": "view.users", "view_args": {} },
        {"text": "Groups", "endpoint": "view.groups", "view_args": {} }
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

@bp.route("/zone/<zid>")
def zone(zid):

    zoneRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                              .where( (UserToZoneRoles.zid == zid) & (UserToZoneRoles.login == flask.g.login) ) \
                              .scalar()

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

@bp.route("/users")
def users():

    if not flask.g.isAdmin:
        flask.abort(403)

    return flask.render_template('users.html')

@bp.route("/groups")
def groups():

    if not flask.g.isAdmin:
        flask.abort(403)

    return flask.render_template('groups.html')

@bp.route("/groups/manage/<group_login>")
def groupManage(group_login):

    if not flask.g.isAdmin:
        flask.abort(403)

    groupName = Users.select(Users.name) \
                     .where( (Users.login == group_login) & (Users.account_type >= ACCOUNT_TYPE_GROUP) ) \
                     .scalar()

    if groupName is None:
        flask.abort(404)

    return flask.render_template('group_manage.html',
                    groupLogin = group_login,
                    groupName = groupName)

