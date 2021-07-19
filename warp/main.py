import flask
import sqlite3
from werkzeug.utils import redirect
from warp.db import getDB
from . import auth

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
    return redirect(flask.url_for("main.bookings",context="user"))

@bp.route("/zone/<zid>")
def zone(zid):

    row = getDB().cursor().execute("SELECT * FROM zone WHERE id = ?",(zid,)).fetchone()

    if row is None:
        flask.abort(404)

    return flask.render_template('zone.html',zone_data=row)

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
    #TODO: time
    query = "SELECT b.*, s.name seat_name, z.name zone_name, u.username username FROM book b" \
            " LEFT JOIN seat s ON s.id = b.sid" \
            " LEFT JOIN zone z ON z.id = s.zid" \
            " LEFT JOIN user u ON b.uid = u.id"
    
    if context == 'user': query += " WHERE uid = ?"
    query += " ORDER BY b.fromTS"

    row = None

    if context == 'user':
        row = getDB().cursor().execute(query,(uid,))
    elif context == 'all':
        row = getDB().cursor().execute(query)

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
            resR["username"] = r['username']

        book_data[r['id']] = resR

    return flask.jsonify(book_data)

@bp.route("/bookings/remove", methods=["POST"])
def bookingsRemove():

    uid = flask.session.get('uid')
    role = flask.session.get('role')
    if role >= auth.ROLE_VIEVER:
        flask.abort(403)

    bid = flask.request.form.get('bid')

    if bid is None:
        flask.abort(404)

    row = getDB().cursor().execute("SELECT * FROM book WHERE id = ?",(bid,)).fetchone()

    if row is None:
        flask.abort(404)
    
    if role >= auth.ROLE_USER and row['uid'] != uid:
        flask.abort(403)    

    db = getDB()
    db.cursor().execute("DELETE FROM book WHERE id = ?",(bid,))
    db.commit()
    
    return flask.Response("OK",200)

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
@bp.route("/seat/getAll/<zid>")
def getAll(zid):

    #TODO: time    
    db = getDB()

    res = {}
    seats = db.cursor().execute("SELECT * FROM seat WHERE zid = ?",(zid,))

    if seats is None:
        flask.abort(404)

    for s in seats:
        sid = s['id']

        resSeat = { "name": s['name'], "x": s['x'], "y": s['y'] }
        resSeat['book'] = {}

        bookings = db.cursor().execute("SELECT b.*, u.username username FROM book b LEFT JOIN user u ON u.id = b.uid WHERE sid = ?",(sid,))

        for b in bookings:

            resBook = { "uid": b['uid'], "username": b['username'], "fromTS": b['fromTS'], "toTS": b['toTS'], "comment": b['comment'] }
            resSeat['book'][b['id']] = resBook
        
        res[sid] = resSeat

    return flask.jsonify(res)
