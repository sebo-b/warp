import flask
from peewee import JOIN

from warp.db import *
from . import utils
from . import blob_storage
from warp.xhr.prefs import get_user_prefs

bp = flask.Blueprint('view', __name__)

@bp.context_processor
def headerDataInit():

    headerDataL = []

    zoneCursor = Zone.select(Zone.id, Zone.name) \
                     .join(UserToZoneRoles, join_type=JOIN.LEFT_OUTER,
                           on=((Zone.id == UserToZoneRoles.zid) & (UserToZoneRoles.login == flask.g.login))) \
                     .where(
                         Zone.zone_type.in_([ZONE_TYPE_PUBLIC_VIEW, ZONE_TYPE_PUBLIC_BOOK]) |
                         ((Zone.zone_type == ZONE_TYPE_ENABLED) & (UserToZoneRoles.zone_role <= ZONE_ROLE_VIEWER)) |
                         (UserToZoneRoles.zone_role == ZONE_ROLE_ADMIN)
                     ) \
                     .order_by(Zone.name)

    for z in zoneCursor:
        headerDataL.append(
            {"text": z['name'], "endpoint": "view.zone", "view_args": {"zid":str(z['id'])} })

    if headerDataL:
        headerDataL.insert(0,{"text": "Bookings", "endpoint": "view.bookings", "view_args": {"report":""} })

    headerDataR = [
        {"text": "Report", "endpoint": "view.bookings", "view_args": {"report": "report"} },
        {"text": "Users", "endpoint": "view.users", "view_args": {} },
        {"text": "Groups", "endpoint": "view.groups", "view_args": {} },
        {"text": "Zones", "endpoint": "view.zones", "view_args": {} }
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
             'hasLogout': 'auth.logout' in flask.current_app.view_functions,
             'hasChangePassword': 'auth.change_password' in flask.current_app.view_functions,
             'minPasswordLength': flask.current_app.config.get('MIN_PASSWORD_LENGTH', 6)
    }

@bp.route("/")
def index():
    default_zone = get_user_prefs(flask.g.login).get('default_zone')

    if default_zone is not None:
        zoneRow = Zone.select(Zone.zone_type).where(Zone.id == default_zone).first()
        if zoneRow:
            specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                          .where((UserToZoneRoles.zid == default_zone) & (UserToZoneRoles.login == flask.g.login)) \
                                          .scalar()
            if effectiveZoneRole(zoneRow['zone_type'], specificRole) is not None:
                return flask.redirect(flask.url_for('view.zone', zid=default_zone))

    return flask.render_template('index.html')

@bp.route("/bookings/<string:report>")
@bp.route("/bookings", defaults={"report": "" })
def bookings(report):

    if report == "report" and not flask.g.isAdmin:
        flask.abort(403)

    return flask.render_template('bookings.html',
        report = (report == "report"),
        maxReportRows = flask.current_app.config['MAX_REPORT_ROWS'])

@bp.route("/zone/<zid>")
def zone(zid):

    zoneRow = Zone.select(Zone.zone_type).where(Zone.id == zid).first()
    if zoneRow is None:
        flask.abort(403)

    specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                  .where((UserToZoneRoles.zid == zid) & (UserToZoneRoles.login == flask.g.login)) \
                                  .scalar()

    zoneRole = effectiveZoneRole(zoneRow['zone_type'], specificRole)
    if zoneRole is None:
        flask.abort(403)

    nextWeek = utils.getNextWeek()

    prefs = get_user_prefs(flask.g.login)

    default_time = prefs.get('default_time', [9 * 3600, 17 * 3600])
    default_day = prefs.get('default_day', 'same')

    zonePreviewPrefs = {
        'show_seat_names': prefs.get('zone_show_seat_names', False),
        'show_booking_preview': prefs.get('zone_show_booking_preview', False),
    }

    defaultSelectedDates = {
        "slider": default_time
    }

    now_ts = utils.now()
    today_ts = utils.today()
    seconds_into_day = now_ts - today_ts

    if default_day == 'boundary':
        target_ts = today_ts + (24 * 3600 if seconds_into_day >= default_time[0] else 0)
    elif default_day == 'tomorrow':
        target_ts = today_ts + (24 * 3600)
    else:
        target_ts = today_ts

    for d in nextWeek:
        if d['timestamp'] >= target_ts:
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
        **zoneRole,
        zid = zid,
        nextWeek=nextWeek,
        today=utils.today(),
        defaultSelectedDates=defaultSelectedDates,
        zonePreviewPrefs=zonePreviewPrefs)

@bp.route("/zone/image/<zid>")
def zoneImage(zid):

    if not flask.g.isAdmin:

        zoneRow = Zone.select(Zone.zone_type).where(Zone.id == zid).first()
        if zoneRow is None:
            flask.abort(403)

        specificRole = UserToZoneRoles.select(UserToZoneRoles.zone_role) \
                                    .where((UserToZoneRoles.zid == zid) & (UserToZoneRoles.login == flask.g.login)) \
                                    .scalar()

        if effectiveZoneRole(zoneRow['zone_type'], specificRole) is None:
            flask.abort(403)

    blobIdQuery = Zone.select(Zone.iid.alias('id')).where(Zone.id == zid)

    return blob_storage.createBlobResponse(blobIdQuery=blobIdQuery)


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

@bp.route("/zones")
def zones():

    if not flask.g.isAdmin:
        flask.abort(403)

    return flask.render_template('zones.html')


@bp.route("/groups/assign/<group_login>")
def groupAssign(group_login):

    if not flask.g.isAdmin:
        flask.abort(403)

    groupName = Users.select(Users.name) \
                     .where( (Users.login == group_login) & (Users.account_type >= ACCOUNT_TYPE_GROUP) ) \
                     .scalar()

    if groupName is None:
        flask.abort(404)

    returnURL = flask.request.args.get('return',flask.url_for('view.groups'))

    return flask.render_template('group_assign.html',
                    groupLogin = group_login,
                    groupName = groupName,
                    returnURL = returnURL)


@bp.route("/zones/assign/<zid>")
def zoneAssign(zid):

    if not flask.g.isAdmin:
        flask.abort(403)

    zoneName = Zone.select(Zone.name) \
                     .where( Zone.id == zid ) \
                     .scalar()

    if zoneName is None:
        flask.abort(404)

    returnURL = flask.request.args.get('return',flask.url_for('view.zones'))

    return flask.render_template('zone_assign.html',
                    zoneName = zoneName,
                    zid = zid,
                    returnURL = returnURL)

@bp.route("/zones/modify/<zid>")
def zoneModify(zid):

    if not flask.g.isAdmin:
        flask.abort(403)

    returnURL = flask.request.args.get('return',flask.url_for('view.zones'))

    return flask.render_template('zone_modify.html',
                    zid = zid,
                    returnURL = returnURL)
