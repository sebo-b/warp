import flask
from peewee import fn
from werkzeug.security import check_password_hash, generate_password_hash
from warp.db import *
from . import utils

bp = flask.Blueprint('auth', __name__)


def loginMatch(login):
    """A peewee predicate matching the stored ``Users.login`` against ``login``,
    case-insensitively when ``LOGIN_IGNORECASE`` is enabled. Sign-in code uses the
    matched row's stored login as the canonical identity, so bookings and group
    membership stay keyed to a single account regardless of the entered case."""
    if login is not None and flask.current_app.config.get('LOGIN_IGNORECASE'):
        return fn.LOWER(Users.login) == login.lower()
    return Users.login == login

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

        c = Users.select().where(loginMatch(u) & (Users.account_type != ACCOUNT_TYPE_GROUP))

        if len(c) == 1 \
           and c[0]['password'] is not None \
           and check_password_hash(c[0]['password'],p):

            account_type = c[0]['account_type']

            if account_type == ACCOUNT_TYPE_BLOCKED:
                flask.flash("Your account is blocked.")
            else:
                flask.session['login'] = c[0]['login']
                flask.session['login_time'] = utils.now(tz="UTC")
                return flask.redirect(flask.url_for('view.index'))

        else:
            flask.flash("Wrong username or password")

    return flask.render_template('login.html')

bp.route('/login', methods=['GET', 'POST'])(login)

def logout():
    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))

bp.route('/logout')(logout)

def applyUserMetadata(login, userData, *, strictMapping=False, warnPrefix="SSO"):
    """Upsert the user, sync display name, and reconcile group membership from
    userData['userName'] and userData['groups']. Returns the canonical stored login.

    Shared by all SSO backends (LDAP, AAD, OIDC). Runs inside an atomic block."""
    with DB.atomic():
        existing = Users.select(Users.login, Users.name).where(loginMatch(login)).first()
        if existing is None:
            Users.insert({
                Users.login: login,
                Users.name: userData["userName"],
                Users.account_type: ACCOUNT_TYPE_USER,
                Users.password: '*'
            }).execute()
        else:
            login = existing['login']    # canonical stored login (case may differ)
            if existing['name'] != userData["userName"]:
                Users.update({Users.name: userData["userName"]}).where(Users.login == login).execute()

        existingGroups = Users.select( Users.login ) \
            .where( Users.account_type == ACCOUNT_TYPE_GROUP ) \
            .where( Users.login.in_(userData["groups"]) ) \
            .tuples()
        existingGroups = [i[0] for i in existingGroups]

        if len(existingGroups) != len(userData["groups"]):
            print(f"{warnPrefix} WARNING: some of the groups defined in the IdP and mapped via group map doesn't exist in Warp")

        insertData = [ {Groups.login: login, Groups.group: i} for i in existingGroups ]
        Groups.insert(insertData).on_conflict_ignore().execute()

        if strictMapping:
            Groups.delete() \
                .where( Groups.login == login ) \
                .where( Groups.group.not_in(existingGroups) ) \
                .execute()

    return login

def buildUserMetadata(login, userName, idpGroups, groupMap):
    """Apply a [[source_group_or_null, warp_group_or_null], …] map to a set of
    IdP groups, returning {'login','userName','groups'} or None to deny access.

    Semantics (identical to LDAP/OIDC):
      * [null, null]            -> open access (login allowed regardless of groups)
      * [null, 'WarpGroup']     -> unconditionally assign 'WarpGroup' (no access grant)
      * ['IdpGroup', 'WarpGrp'] -> if user in 'IdpGroup': allow + assign 'WarpGrp'
      * ['IdpGroup', null]      -> if user in 'IdpGroup': allow, assign nothing
    Returns None when no entry grants access.
    """
    idpGroups = idpGroups or []

    ret = {
        'login':    login,
        'userName': userName,
        'groups':   [],
    }

    loginAllowed = False
    for idpGroup, warpGroup in groupMap:
        if idpGroup is None and warpGroup is None:
            loginAllowed = True          # [null,null] => open access
            continue
        if idpGroup is None:
            ret['groups'].append(warpGroup)   # unconditional group assignment
            continue
        if idpGroup in idpGroups:
            loginAllowed = True
            if warpGroup:
                ret['groups'].append(warpGroup)

    if not loginAllowed:
        return None                      # no matching group and no [null,null] => deny

    return ret

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

    # PWA plumbing must be public. Manifest fetches are a spec'd special case
    # among <link>s: credentials mode is "omit" EVEN SAME-ORIGIN unless the
    # <link> carries crossorigin="use-credentials" — so the session cookie is
    # never sent and a login redirect here would make the app uninstallable.
    # (Install can also legitimately start from the pre-login page anyway.)
    # Neither file is sensitive.
    if flask.request.endpoint in ('view.manifest', 'view.serviceWorker'):
        return

    if flask.request.blueprint == 'debug':
        if not flask.current_app.debug:
            flask.abort(403)
        return

    def expired():
        # The SPA can't follow a redirect from an XHR (it would just land the
        # raw login HTML in the fetch response) — signal expiry as JSON so the
        # client can do a full-page navigate to the login route itself.
        if flask.request.path.startswith('/xhr'):
            return flask.jsonify({"code": "SESSION_EXPIRED"}), 401
        return flask.redirect(flask.url_for('auth.login'))

    login = flask.session.get('login')

    if login is None:
        return expired()

    latestValidSessionTime = utils.now(tz="UTC") - 24*3600*flask.current_app.config['SESSION_LIFETIME']
    lastLoginTime = flask.session.get('login_time')

    if lastLoginTime is None or lastLoginTime < latestValidSessionTime:
        return expired()

    # check if user still exists and if it is not blocked
    c = Users.select(Users.account_type, Users.name).where(Users.login == login)

    if len(c) != 1 or c[0]['account_type'] >= ACCOUNT_TYPE_BLOCKED:
        return expired()

    flask.g.isAdmin = c[0]['account_type'] == ACCOUNT_TYPE_ADMIN
    flask.g.login = login
    flask.g.name = c[0]['name']


bp.before_app_request(session)
