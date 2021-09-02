import flask
from warp.db import getDB
from warp.auth import ROLE_USER, ROLE_BLOCKED, session
from . import utils

bp = flask.Blueprint('auth', __name__)

@bp.route('/login')
def login():

    # force SAML request
    if flask.session.get('uid'):

        flask.session.clear()
        
        mellonEndpoint = flask.current_app.config['MELLON_ENDPOINT']
        endpoint = f"{mellonEndpoint}/login?ReturnTo={flask.url_for('auth.login')}"
        
        return flask.redirect(endpoint)

    db = getDB()
    cursor = db.cursor()

    u = flask.request.environ['MELLON_uid']

    userRow = cursor.execute("SELECT * FROM user WHERE login = ?",(u,)).fetchone()

    if userRow is not None:

        if userRow['role'] >= ROLE_BLOCKED:
            flask.abort(403)

        flask.session['uid'] = userRow['id']
        flask.session['role'] = userRow['role']

    else:

        name = flask.request.environ['MELLON_cn']
        name = bytes(name,'ISO-8859-1').decode('utf-8')

        try:

            cursor.execute("INSERT INTO user (login,password,name,role) VALUES (?,?,?,?)",(u,'*',name,ROLE_USER))
            db.commit()

        except:
            db.rollback()
            raise

        flask.session['uid'] = cursor.lastrowid
        flask.session['role'] = ROLE_USER

    flask.session['login_time'] = utils.now()

    return flask.redirect(flask.url_for('view.index'))

@bp.route('/logout')
def logout():

    flask.session.clear()
    
    mellonEndpoint = flask.current_app.config['MELLON_ENDPOINT']
    endpoint = f"{mellonEndpoint}/logout?ReturnTo={flask.url_for('auth.login')}"
    
    return flask.redirect(endpoint)


bp.before_app_request(session)