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
#    sidN: { name: "name", x: 10, y: 10,
#       book: {
#           bidN: { uid: 10, username: "sebo", fromTS: 1, toTS: 2, comment: "" }
@bp.route("/zone/getSeats/<zid>")
def zoneGetSeats(zid):

    db = getDB()

    res = {}
    seats = db.cursor().execute("SELECT * FROM seat WHERE zid = ?",(zid,)).fetchall()

    if seats is None:
        flask.abort(404)

    for s in seats:

        res[s['id']] = {
            "name": s['name'],
            "x": s['x'],
            "y": s['y'],
            "book": {}
        }

    tr = utils.getTimeRange()
    
    bookings = db.cursor().execute("SELECT b.*, u.name username FROM book b" \
                                   " LEFT JOIN user u ON u.id = b.uid" \
                                   " LEFT JOIN seat s ON b.sid = s.id" \
                                   " WHERE b.fromTS < ? AND b.toTS > ?" \
                                   " AND s.zid = ?",
                                   (tr['toTS'],tr['fromTS'],zid,))

    for b in bookings:

        sid = b['sid']
        bid = b['id']

        res[sid]['book'][bid] = { 
            "uid": b['uid'], 
            "username": b['username'], 
            "fromTS": b['fromTS'], 
            "toTS": b['toTS'], 
            "comment": b['comment'] 
        }

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
