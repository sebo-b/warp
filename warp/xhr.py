import flask
import sqlite3
from werkzeug.utils import redirect
from .db import getDB
from . import auth
from . import utils
from jsonschema import validate, ValidationError

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
#    sidN: { name: "name", x: 10, y: 10, other_zone: true,
#       book: [
#           { bid: 10, uid: 10, username: "sebo", fromTS: 1, toTS: 2, comment: "" }
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

    seats = db.cursor().execute("SELECT s.* FROM seat s" \
                                " JOIN zone z ON s.zid = z.id" \
                                " WHERE z.zone_group = ?",
                                (zone_group,))

    if seats is None:
        flask.abort(404)

    for s in seats:

        res[s['id']] = {
            "name": s['name'],
            "x": s['x'],
            "y": s['y'],
            "other_zone": (str(s['zid']) != zid),
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

    for b in bookings:

        sid = b['sid']
        
        res[sid]['book'].append({ 
            "bid": b['id'],
            "uid": b['uid'], 
            "username": b['username'], 
            "fromTS": b['fromTS'], 
            "toTS": b['toTS'], 
            "comment": b['comment'] })

    return flask.jsonify(res)

# format:
# { 
#   action: 'book|update|delete',
#   sid: sid,
#   dates: [
#       { fromTS: timestamp, toTS: timestamp },
#       { fromTS: timestamp, toTS: timestamp },
#   ]
# }
@bp.route("/zone/action", methods=["POST"])
def zoneAction():

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
            "action" : {"enum": ["book", "update", "delete"] },
            "sid" : {"type" : "integer"},
            "dates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "fromTS": {"type" : "integer"},
                        "toTS": {"type" : "integer"}
                    }
                }
            }
        }
    }

    if role >= auth.ROLE_USER:
        ts = utils.getTimeRange()
        schema["properties"]["dates"]["items"]["properties"]["fromTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["dates"]["items"]["properties"]["fromTS"]["maximum"] = ts["toTS"]
        schema["properties"]["dates"]["items"]["properties"]["toTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["dates"]["items"]["properties"]["toTS"]["maximum"] = ts["toTS"]

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "invalid input" }, 400

    db = getDB()

    try:
        cursor = db.cursor()

        if action_data['action'] == 'delete':
            for d in action_data['dates']:            
                cursor.execute("DELETE FROM book WHERE fromTS < ? AND toTS > ? AND sid = ? AND uid = ?",
                                (d['toTS'],d['fromTS'],action_data['sid'],uid))
        elif action_data['action'] == 'update':
            for d in action_data['dates']:            
                cursor.execute("DELETE FROM book WHERE fromTS < ? AND toTS > ? AND uid = ?",
                                (d['toTS'],d['fromTS'],uid))

        if action_data['action'] == 'book' or action_data['action'] == 'update':
            for d in action_data['dates']:
                cursor.execute("INSERT INTO book (uid,sid,fromTS,toTS) VALUES (?,?,?,?)",
                            (uid,action_data['sid'],d['fromTS'],d['toTS']))    

        db.commit()

    except sqlite3.IntegrityError as err:
        db.rollback()
        return {"msg": str(err) }, 400

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