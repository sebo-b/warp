import flask
from werkzeug.security import check_password_hash
from warp.db import *
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

        c = Users.select().where((Users.login == u) & (Users.account_type != ACCOUNT_TYPE_GROUP))

        if len(c) == 1 \
           and c[0]['password'] is not None \
           and check_password_hash(c[0]['password'],p):

            account_type = c[0]['account_type']

            if account_type == ACCOUNT_TYPE_BLOCKED:
                flask.flash("Your account is blocked.")
            else:
                flask.session['login'] = c[0]['login']
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

    login = flask.session.get('login')

    if login is None:
        return flask.redirect(
            flask.url_for('auth.login'))

    latestValidSessionTime = utils.now() - 24*3600*flask.current_app.config['SESSION_LIFETIME']
    lastLoginTime = flask.session.get('login_time')

    if lastLoginTime is None or lastLoginTime < latestValidSessionTime:
        return flask.redirect(
            flask.url_for('auth.login'))

    # check if user still exists and if it is not blocked
    c = Users.select(Users.account_type).where(Users.login == login)

    if len(c) != 1 or c[0]['account_type'] >= ACCOUNT_TYPE_BLOCKED:
        return flask.redirect(
            flask.url_for('auth.login'))

    flask.g.isAdmin = c[0]['account_type'] == ACCOUNT_TYPE_ADMIN

    groups = Groups.select(Groups.group).where(Groups.login == login).tuples()
    flask.g.login = login
    flask.g.groups = [login] + [ g[0] for g in groups ]

bp.before_app_request(session)
