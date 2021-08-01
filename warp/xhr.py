import flask
from werkzeug.utils import redirect
from .db import getDB
from . import auth
from . import utils
from jsonschema import validate, ValidationError
from sqlite3.dbapi2 import Error

bp = flask.Blueprint('xhr', __name__)

# format
# { bid: bid }
@bp.route("/bookings/remove", methods=["POST"])
def bookingsRemove():

    if not flask.request.is_json:
        flask.abort(404)

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    if role >= auth.ROLE_VIEVER:
        flask.abort(403)

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {
            "bid" : {"type" : "integer"},
        }
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "invalid input" }, 400
 
    db = getDB()
    db.cursor().execute("DELETE FROM book" \
                        " WHERE id = ?" \
                        " AND (? OR uid = ?)",
                        (action_data['bid'],role < auth.ROLE_USER, uid) )
    
    db.commit()
    
    return {"msg": "ok" }, 200

#Format JSON
#    sidN: { name: "name", x: 10, y: 10, zid: zid, enabled: true|false,
#       book: [
#           { bid: 10, isMine: true, username: "sebo", fromTS: 1, toTS: 2, comment: "" }
# note that book array is sorted on fromTS
@bp.route("/zone/getSeats/<zid>")
def zoneGetSeats(zid):

    db = getDB()

    res = {}
    zone_group = db.cursor().execute("SELECT zone_group FROM zone WHERE id = ?",(zid,)).fetchone()

    if zone_group is None:
        flask.abort(404)
    else:
        zone_group = zone_group[0]

    role = flask.session.get('role')

    seats = db.cursor().execute("SELECT s.* FROM seat s" \
                                " JOIN zone z ON s.zid = z.id" \
                                " WHERE z.zone_group = ?" \
                                " AND (? OR enabled IS TRUE)",
                                (zone_group,role <= auth.ROLE_MANAGER))

    if seats is None:
        flask.abort(404)

    for s in seats:

        res[s['id']] = {
            "name": s['name'],
            "x": s['x'],
            "y": s['y'],
            "zid": s['zid'],
            "enabled": s['enabled'],
            "book": []
        }

    tr = utils.getTimeRange()
    
    bookings = db.cursor().execute("SELECT b.*, u.name username FROM book b" \
                                   " JOIN user u ON u.id = b.uid" \
                                   " JOIN seat s ON b.sid = s.id" \
                                   " JOIN zone z ON s.zid = z.id" \
                                   " WHERE b.fromTS < ? AND b.toTS > ?" \
                                   " AND z.zone_group = ?" \
                                   " ORDER BY fromTS",
                                   (tr['toTS'],tr['fromTS'],zone_group,))

    uid = flask.session.get('uid')

    for b in bookings:

        sid = b['sid']
        
        res[sid]['book'].append({ 
            "bid": b['id'],
            "isMine": b['uid'] == uid,
            "username": b['username'],
            "fromTS": b['fromTS'], 
            "toTS": b['toTS'], 
            "comment": b['comment'] })

    return flask.jsonify(res)

# format:
# { 
#   enable: [ sid, sid, ...],
#   disable: [ sid, sid, ...],
#   book: {
#       sid: sid,
#       dates: [
#           { fromTS: timestamp, toTS: timestamp },
#           { fromTS: timestamp, toTS: timestamp },
#       ]
#   },
#   remove: [ bid, bid, bid]
# }
@bp.route("/zone/apply", methods=["POST"])
def zoneApply():

    if not flask.request.is_json:
        flask.abort(404)

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    if role >= auth.ROLE_VIEVER:
        flask.abort(403)

    apply_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {
            "enable": {
                "type": "array",
                "items": {
                    "type": "integer"
                }
            },
            "disable": {
                "type": "array",
                "items": {
                    "type": "integer"
                }
            },
            "book": {
                "type": "object",
                "properties": {
                    "sid" : {"type" : "integer"},
                    "dates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "fromTS": {"type" : "integer"},
                                "toTS": {"type" : "integer"}
                            },
                            "required": [ "fromTS", "toTS"]
                        }                       
                    }
                },
                "required": [ "sid", "dates"],
            },
            "remove": {
                "type": "array",
                "items": {
                    "type": "integer"
                }
            }
        },
        "anyOf": [
            {"required": [ "enable" ]},
            {"required": [ "disable" ]},                        
            {"required": [ "book" ]},
            {"required": [ "remove" ]}
        ]
    }

    if role >= auth.ROLE_USER:
        ts = utils.getTimeRange()
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["fromTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["fromTS"]["maximum"] = ts["toTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["toTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["toTS"]["maximum"] = ts["toTS"]

    try:
        validate(apply_data,schema)
    except ValidationError as err:
        return {"msg": "invalid input" }, 400

    if ('enable' in apply_data or 'disable' in apply_data) and role > auth.ROLE_MANAGER:
        return {"msg": "Forbidden" }, 403

    db = getDB()

    conflicts_in_disable = []

    try:
        cursor = db.cursor()

        if 'enable' in apply_data:
            cursor.execute(
                "UPDATE seat SET enabled=TRUE WHERE id in (%s)" % (",".join(['?']*len(apply_data['enable']))),
                apply_data['enable'])

        if 'disable' in apply_data:

            ts = utils.getTimeRange(True)
            q = "SELECT b.*, u.login, u.name FROM book b" \
                           " JOIN user u ON b.uid = u.id" \
                           " WHERE b.fromTS < ? AND b.toTS > ?" \
                           " AND b.sid IN (%s)" % (",".join(['?']*len(apply_data['disable'])))
            
            cursor.execute(q,[ts['toTS'],ts['fromTS']]+apply_data['disable'])

            for row in cursor:
                conflicts_in_disable.append({
                    "sid": row['sid'],
                    "fromTS": row['fromTS'],
                    "toTS": row['toTS'],
                    "login": row['login'],
                    "username": row['name']
                })


            cursor.execute(
                "UPDATE seat SET enabled=FALSE WHERE id IN (%s)" % (",".join(['?']*len(apply_data['disable']))),
                apply_data['disable'])

        # befor book we have to remove reservations (as this can be list of conflicting reservations)
        if 'remove' in apply_data:
            cursor.executemany("DELETE FROM book WHERE id = ? AND uid = ?",
                ((id,uid) for id in apply_data['remove']))

        # then we create new reservations
        if 'book' in apply_data:

            seat_enabled = cursor.execute("SELECT enabled FROM seat WHERE id = ?",(apply_data['book']['sid'],)).fetchone()
            if not seat_enabled['enabled']:
                raise Error("Booking a disabled seat is forbidden.")

            cursor.executemany("INSERT INTO book (uid,sid,fromTS,toTS) VALUES (?,?,?,?)",
                ((uid,apply_data['book']['sid'],x['fromTS'], x['toTS']) for x in apply_data['book']['dates']))

        db.commit()

    except Error as err:
        db.rollback()
        return {"msg": str(err) }, 400

    if conflicts_in_disable:
        return {"msg": "ok", "conflicts_in_disable": conflicts_in_disable}, 200

    return {"msg": "ok" }, 200


#Format
# {
#   data: {
#         user1: null,    
#         user2: null,    
#         ...    
#       },
#   default: user1
#   selected: user2
# }
@bp.route("/actas/get")
def actAsGet():

    uid = flask.session.get('uid')
    real_uid = flask.session.get('real-uid')
    role = flask.session.get('role')

    if role > auth.ROLE_MANAGER:
        flask.abort(403)

    db = getDB()
    cur = db.cursor().execute("SELECT id,login,name FROM user")

    res = {
        "data": {}
    }

    for u in cur:

        text = f"{u['name']} [{u['login']}]"
        res["data"][text] = None

        if u['id'] == uid:
            res["selected"] = text

        if real_uid and u['id'] == real_uid:
            res["default"] = text

    if "default" not in res:
        res["default"] = res["selected"]

    return res, 200

# Format
# { login: login }
@bp.route("/actas/set", methods=["POST"])
def actAsSet():

    if not flask.request.is_json:
        flask.abort(404)

    role = flask.session.get('role')

    if role > auth.ROLE_MANAGER:
        flask.abort(403)

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {
            "login" : {"type" : "string"}
        }
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "invalid input" }, 400

    userRow = getDB().cursor().execute("SELECT id FROM user WHERE login = ?",(action_data['login'],)).fetchone();

    if userRow is None:
        return {"msg": "not found"}, 404

    if not flask.session.get('real-uid'):
        flask.session['real-uid'] = flask.session.get('uid')

    flask.session['uid'] = userRow['id']

    return {"msg": "ok"}, 200