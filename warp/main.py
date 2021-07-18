import flask
from warp.db import getDB
#from warp import app, getDB

bp = flask.Blueprint('main', __name__)

@bp.before_request
def authentication():

    if flask.session.get('user') is None:
        return flask.redirect(
            flask.url_for('auth.login'))


@bp.route("/test")
def test(id = None):

    name = "Ehh"
    db = getDB()
    
    return flask.render_template('test.html',name=name)
