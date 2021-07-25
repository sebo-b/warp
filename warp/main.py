import flask
import sqlite3
from werkzeug.utils import redirect
from .db import getDB
from . import auth
from . import utils
from jsonschema import validate, ValidationError

bp = flask.Blueprint('main', __name__)

@bp.before_request
def authentication():

    if flask.session.get('uid') is None:
        return flask.redirect(
            flask.url_for('auth.login'))


    zonesCur = getDB().cursor().execute("SELECT id,name FROM zone")
    flask.g.zones = {}
    for z in zonesCur:
        flask.g.zones[ z['id'] ] = z['name']

    flask.g.isManager = (flask.session.get('role') <= auth.ROLE_MANAGER)


@bp.route("/")
def index():
    return flask.render_template('index.html')

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

@bp.route("/bookings/<context>")
def bookings(context):

    if context != 'all' and context != 'user':
        flask.abort(404)

    if context == 'all' and flask.session.get('role') > auth.ROLE_MANAGER:
        flask.abort(403)

    return flask.render_template('bookings.html', context=context)

@bp.route("/bookings/get/<context>")
def bookingsGet(context):

    if context != 'all' and context != 'user':
        flask.abort(404)

    if context == 'all' and flask.session.get('role') > auth.ROLE_MANAGER:
        flask.abort(403)

    uid = flask.session.get('uid')
    
    timeRange = utils.getTimeRange()

    query = "SELECT b.*, s.name seat_name, z.name zone_name, u.login login FROM book b" \
            " LEFT JOIN seat s ON s.id = b.sid" \
            " LEFT JOIN zone z ON z.id = s.zid" \
            " LEFT JOIN user u ON b.uid = u.id" \
            " WHERE b.toTS > ?" \
            " AND (? OR uid = ?)" \
            " ORDER BY b.fromTS"
    
    isAdmin = context == 'all'
    row = getDB().cursor().execute(query,(timeRange['fromTS'], isAdmin, uid))

    book_data = {}
    for r in row:
        resR = {
            "fromTS": r['fromTS'],
            "toTS": r['toTS'],
            "seat_name": r['seat_name'],
            "zone_name": r['zone_name'],
            "comment": r['comment']
        }
        if context == 'all':
            resR["login"] = r['login']

        book_data[r['id']] = resR

    return flask.jsonify(book_data)

#TODO: change to JSON?
@bp.route("/bookings/remove", methods=["POST"])
def bookingsRemove():

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    if role >= auth.ROLE_VIEVER:
        flask.abort(403)

    bid = flask.request.form.get('bid')

    if bid is None:
        flask.abort(404)
 
    db = getDB()
    if role >= auth.ROLE_USER:
        db.cursor().execute("DELETE FROM book WHERE id = ? AND uid = ?",(bid,uid))
    else:
        db.cursor().execute("DELETE FROM book WHERE id = ?",(bid,))
    
    db.commit()
    
    return flask.Response("OK",200)

#TODO: not used?
@bp.route("/bookings/edit", methods=["POST"])
def bookingsEdit():

    role = flask.session.get('role')
    if role >= auth.ROLE_VIEVER:
        return {"msg":"You don't have sufficient privileges."},403

    id = flask.request.form.get('id')
    uid = flask.session.get('uid')
    sid = flask.request.form.get('sid')
    fromTS = flask.request.form.get('fromTS')
    toTS = flask.request.form.get('toTS')
    comment = flask.request.form.get('comment')

    if role > auth.ROLE_MANAGER:
        MIN_TIME = 10*60
        if fromTS is not None and (int(fromTS) % MIN_TIME) > 0:
            return flask.Response(flask.json.dumps({"msg":"Minimum time step is 10 min."}),400)
        if toTS is not None and (int(toTS) % MIN_TIME) > 0:
            return flask.Response(flask.json.dumps({"msg":"Minimum time step is 10 min."}),400)

    db = getDB()
    cur = db.cursor()

    bid = None

    try:

        if id is None:
            cur.execute("INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (?,?,?,?,?)",(uid,sid,fromTS,toTS,comment))
            id = cur.lastrowid
        else:
            data = {"sid": sid, "fromTS": fromTS, "toTS": toTS, "comment": comment }

            if flask.request.form.get('uid') is not None and role <= auth.ROLE_MANAGER:
                data['uid'] = flask.request.form.get('uid')
            
            query = ""
            params = []

            for k,v in data.items():
                if v is not None:
                    query = query + ","+k+"=?"
                    list.append(params,v)

            if query == "":
                return flask.Response(flask.json.dumps({"msg":"Nothing to update."}),400)

            query = "UPDATE book SET " + query[1:] + " WHERE id = ?"
            list.append(params,id)

            # make sure that user doesn't modify others records
            if role > auth.ROLE_MANAGER:
                query = query + " AND uid = ?"
                list.append(params,uid)

            cur.execute(query, tuple(params))

            if cur.rowcount == 0:
                return {"msg": "Nothing updated"}, 403

        db.commit()

    except sqlite3.IntegrityError as err:
        return {"msg": str(err) }, 400

    return {"msg":"OK", "id":id}, 200


#Format JSON
#    sidN: { name: "name", x: 10, y: 10,
#       book: {
#           bidN: { uid: 10, username: "sebo", fromTS: 1, toTS: 2, comment: "" }
@bp.route("/seat/get/<zid>")
def seatGet(zid):

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
@bp.route("/seat/action", methods=["POST"])
def seatAction():

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
