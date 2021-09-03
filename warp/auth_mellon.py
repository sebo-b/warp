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

    cursor = getDB().cursor()

    login = flask.request.environ['MELLON_uid']
    userName = bytes(flask.request.environ['MELLON_cn'],'ISO-8859-1').decode('utf-8')

    cursor.execute("SELECT id,role,name FROM users WHERE login = ?",(login,))
    userRow = cursor.fetchone()

    if userRow is not None:

        if userRow['role'] >= ROLE_BLOCKED:
            flask.abort(403)

        flask.session['uid'] = userRow['id']
        flask.session['role'] = userRow['role']

        if userRow['name'] != userName:
            try:
                cursor.execute("UPDATE users SET name = ? WHERE login = ?",(userName,login))
                getDB().commit()
            except:
                getDB().rollback()
                raise

    else:

        try:

            cursor.execute("INSERT INTO users (login,password,name,role) VALUES (?,?,?,?)",(login,'*',userName,ROLE_USER))
            getDB().commit()

        except:
            getDB().rollback()
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