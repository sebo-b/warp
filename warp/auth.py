import flask
from werkzeug.security import check_password_hash, generate_password_hash
from warp.db import getDB
from . import utils

ROLE_ADMIN = 0
ROLE_MANAGER = 1
ROLE_USER = 2
ROLE_VIEVER = 3
ROLE_BLOCKED = 100

bp = flask.Blueprint('auth', __name__)

@bp.route('/login', methods=['GET', 'POST'])
def login():

    # clear session to force re-login
    # we should not do it via logout as in case of SSO
    # we will logout from SSO, and we just want to issue
    # an extra request to SSO
    flask.session.clear()

    if flask.request.method == 'POST':

        u = flask.request.form.get('login')
        p =  flask.request.form.get('password')

        #print(generate_password_hash(p))

        userRow = getDB().cursor().execute("SELECT * FROM user WHERE login = ?",(u,)).fetchone()

        if userRow is not None \
           and userRow['password'] is not None \
           and check_password_hash(userRow['password'],p):
            
            role = userRow['role']

            if role >= ROLE_BLOCKED:
                flask.flash("Your account is blocked.")
            else:
                flask.session['uid'] = userRow['id']
                flask.session['role'] = userRow['role']
                flask.session['login_time'] = utils.now()
                return flask.redirect(flask.url_for('view.index'))

        else:
            flask.flash("Wrong username or password")
        
    return flask.render_template('login.html')

@bp.route('/logout')
def logout():
    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))

@bp.before_app_request
def session():

    if flask.request.blueprint == 'auth':
        return

    if flask.request.endpoint == 'static' and 'zone_maps' not in flask.request.view_args['filename']:
        return

    uid = flask.session.get('uid')

    if uid is None:
        return flask.redirect(
            flask.url_for('auth.login'))

    latestValidSessionTime = utils.now() - 24*3600*flask.current_app.config['SESSION_LIFETIME']
    lastLoginTime = flask.session.get('login_time')

    if lastLoginTime is None or lastLoginTime < latestValidSessionTime:
        return flask.redirect(
            flask.url_for('auth.login'))

    # check if user still exists and if it is not blocked
    userRow = getDB().cursor().execute("SELECT * FROM user WHERE id = ?",(uid,)).fetchone()
    if userRow is None or userRow['role'] >= ROLE_BLOCKED:
        return flask.redirect(
            flask.url_for('auth.login'))

    if userRow['role'] != flask.session.get('role'):
        flask.session['role'] = userRow['role']
