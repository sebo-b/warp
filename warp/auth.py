import flask
from werkzeug.security import check_password_hash, generate_password_hash
from warp.db import *
from . import utils

bp = flask.Blueprint('auth', __name__)

# NOTE:
# In this module I don't use decorators (route and before_app_request) to register
# functions in blueprint I register them after the function definition
# this exposes a raw function ,so it can be registered in alternative auth modules.
#
# BTW: both route and before_app_request are just registering a function, they return
#      unwrapped function reference however this may change in the future, so let's keep it clean


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

bp.route('/login', methods=['GET', 'POST'])(login)

def logout():
    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))

bp.route('/logout')(logout)

changePasswordSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "old_password": {"type": "string"},
        "new_password": {"type": "string"}
    },
    "required": ["old_password", "new_password"]
}

def change_password():
    login = flask.session.get('login')
    if login is None:
        return {"msg": "Unauthorized", "code": 22}, 401

    user = Users.select(Users.password, Users.account_type) \
                .where((Users.login == login) & (Users.account_type != ACCOUNT_TYPE_GROUP)) \
                .first()

    if not user or user['account_type'] >= ACCOUNT_TYPE_BLOCKED:
        return {"msg": "Unauthorized", "code": 22}, 401

    jsonData = flask.request.get_json()
    old_password = jsonData['old_password']
    new_password = jsonData['new_password']

    if user['password'] is None \
       or not check_password_hash(user['password'], old_password):
        return {"msg": "Wrong current password", "code": 20}, 400

    min_length = flask.current_app.config.get('MIN_PASSWORD_LENGTH', 6)
    if len(new_password) < min_length:
        return {"msg": "Password must be at least %d characters" % min_length, "code": 21}, 400

    Users.update({Users.password: generate_password_hash(new_password)}) \
         .where(Users.login == login) \
         .execute()

    return {"msg": "Password changed successfully"}, 200

bp.route('/change_password', methods=['POST'])(utils.validateJSONInput(changePasswordSchema)(change_password))

def session():

    if flask.request.blueprint in ('auth', 'ical'):
        return

    if flask.request.endpoint == 'static':
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
    flask.g.login = login


bp.before_app_request(session)
