import flask
from werkzeug.security import check_password_hash, generate_password_hash
from warp.db2 import *
from . import utils


#NOTE: these roles are also defined in userdata.js
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

        c = Users.select().where(Users.login == u)

        if len(c) == 1 \
           and c[0]['password'] is not None \
           and check_password_hash(c[0]['password'],p):
            
            role = c[0]['role']

            if role >= ROLE_BLOCKED:
                flask.flash("Your account is blocked.")
            else:
                flask.session['uid'] = c[0]['id']
                flask.session['role'] = c[0]['role']
                flask.session['login_time'] = utils.now()
                return flask.redirect(flask.url_for('view.index'))

        else:
            flask.flash("Wrong username or password")
        
    return flask.render_template('login.html')

@bp.route('/logout')
def logout():
    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))

# We don't use before_app_request decorator here (we register it after the function)
# to expose a raw function ,so it can be registered in alternative auth modules.
# 
# Note: bp.before_app_request is just registering a function, it returns unwrapped function reference
#       however this may change in the future, so let's keep it clean
# @bp.before_app_request
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
    real_uid = uid
    if flask.session.get('real-uid'):
        real_uid = flask.session.get('real-uid')

    c = Users.select(Users.role).where(Users.id == real_uid)

    if len(c) != 1 or c[0]['role'] >= ROLE_BLOCKED:
        return flask.redirect(
            flask.url_for('auth.login'))

    if c[0]['role'] != flask.session.get('role'):
        flask.session['role'] = c[0]['role']

bp.before_app_request(session)
