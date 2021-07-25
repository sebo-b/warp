import flask
import sqlite3
from werkzeug.utils import redirect
from .db import getDB
from . import auth
from . import utils
from jsonschema import validate, ValidationError

#bp = flask.Blueprint('main', __name__)

#not used?
#@bp.route("/bookings/edit", methods=["POST"])
#def bookingsEdit():
#
#    role = flask.session.get('role')
#    if role >= auth.ROLE_VIEVER:
#        return {"msg":"You don't have sufficient privileges."},403
#
#    id = flask.request.form.get('id')
#    uid = flask.session.get('uid')
#    sid = flask.request.form.get('sid')
#    fromTS = flask.request.form.get('fromTS')
#    toTS = flask.request.form.get('toTS')
#    comment = flask.request.form.get('comment')
#
#    if role > auth.ROLE_MANAGER:
#        MIN_TIME = 10*60
#        if fromTS is not None and (int(fromTS) % MIN_TIME) > 0:
#            return flask.Response(flask.json.dumps({"msg":"Minimum time step is 10 min."}),400)
#        if toTS is not None and (int(toTS) % MIN_TIME) > 0:
#            return flask.Response(flask.json.dumps({"msg":"Minimum time step is 10 min."}),400)
#
#    db = getDB()
#    cur = db.cursor()
#
#    bid = None
#
#    try:
#
#        if id is None:
#            cur.execute("INSERT INTO book (uid,sid,fromTS,toTS,comment) VALUES (?,?,?,?,?)",(uid,sid,fromTS,toTS,comment))
#            id = cur.lastrowid
#        else:
#            data = {"sid": sid, "fromTS": fromTS, "toTS": toTS, "comment": comment }
#
#            if flask.request.form.get('uid') is not None and role <= auth.ROLE_MANAGER:
#                data['uid'] = flask.request.form.get('uid')
#            
#            query = ""
#            params = []
#
#            for k,v in data.items():
#                if v is not None:
#                    query = query + ","+k+"=?"
#                    list.append(params,v)
#
#            if query == "":
#                return flask.Response(flask.json.dumps({"msg":"Nothing to update."}),400)
#
#            query = "UPDATE book SET " + query[1:] + " WHERE id = ?"
#            list.append(params,id)
#
#            # make sure that user doesn't modify others records
#            if role > auth.ROLE_MANAGER:
#                query = query + " AND uid = ?"
#                list.append(params,uid)
#
#            cur.execute(query, tuple(params))
#
#            if cur.rowcount == 0:
#                return {"msg": "Nothing updated"}, 403
#
#        db.commit()
#
#    except sqlite3.IntegrityError as err:
#        db.rollback()
#        return {"msg": str(err) }, 400
#
#    return {"msg":"OK", "id":id}, 200
