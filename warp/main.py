import flask
from warp.db import getDB

bp = flask.Blueprint('main', __name__)

@bp.before_request
def authentication():

    if flask.session.get('user') is None:
        return flask.redirect(
            flask.url_for('auth.login'))


    zonesCur = getDB().cursor().execute("SELECT id,name FROM zone")
    flask.g.zones = {}
    for z in zonesCur:
        flask.g.zones[ z['id'] ] = z['name']

@bp.route("/zone/<zid>")
def space(zid):

    row = getDB().cursor().execute("SELECT * FROM zone WHERE id = ?",(zid,)).fetchone()
    
    if row is None:
        flask.abort(404)

    return flask.render_template('zone.html',zone_data=row)

@bp.route("/test")
def test(id = None):

    name = "Ehh"
    db = getDB()
    
    return flask.render_template('test.html',name=name)
