import flask
from werkzeug.security import check_password_hash
import json
import traceback
from warp.db import *
from . import utils
from ldap3 import Server, Connection, ALL, NTLM, Tls, SIMPLE
import  ssl
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
import sys
##################################################################################################
# Login in LDAP Server or Active Directoory.
#  Check user password and group. User must belong to a LDAP group mapped to WARP group.
#  If user does not exist create it into especified group 
#  Created user obtain name form LDAP Attribute
#
#
##################################################################################################
#NOTE: these roles are also defined in userdata.js
ROLE_ADMIN = 0
ROLE_MANAGER = 1
ROLE_USER = 2
ROLE_VIEVER = 3
ROLE_BLOCKED = 100

bp = flask.Blueprint('auth', __name__)

def ldapValidateCredentials(username, password):

    try:       
        #LOAD CONFIG  
        LDAP_GROUP_MAP = flask.current_app.config.get('LDAP_GROUP_MAP') or []
        LDAP_USER_CLASS = flask.current_app.config.get('LDAP_USER_CLASS') or 'user'
        LDAP_USER_ID_ATTRIBUTE = flask.current_app.config.get('LDAP_USER_ID_ATTRIBUTE') 
        LDAP_USER_NAME_ATTRIBUTE = flask.current_app.config.get('LDAP_USER_NAME_ATTRIBUTE')
        LDAP_USER_GROUPS_ATTRIBUTE= flask.current_app.config.get('LDAP_USER_GROUPS_ATTRIBUTE')
        LDAP_SEARCH_BASE= flask.current_app.config.get('LDAP_SEARCH_BASE')
        LDAP_AUTH_SERVER= flask.current_app.config.get('LDAP_AUTH_SERVER')
        LDAP_AUTH_USE_SSL= True if flask.current_app.config.get('LDAP_AUTH_USE_SSL') == 'true' else False
        LDAP_AUTH_SERVER_PORT= int(flask.current_app.config.get('LDAP_AUTH_SERVER_PORT')) or 389
        LDAP_AUTH_TYPE= flask.current_app.config.get('LDAP_AUTH_TYPE') or 'SIMPLE'
        LDAP_AUTH_NTLM_DOMAIN= flask.current_app.config.get('LDAP_AUTH_NTLM_DOMAIN')  

        # TODO ADD suport to SSL and TLS configuration.
        # tls_configuration = Tls(validate=ssl.CERT_REQUIRED, version=ssl.PROTOCOL_TLSv1)
        # server = Server(LDAP_AUTH_SERVER, port=LDAP_AUTH_SERVER_PORT, use_ssl=LDAP_AUTH_USE_SSL, tls=tls_configuration)
       
        authType= NTLM if (LDAP_AUTH_TYPE == 'NTLM') else SIMPLE 
        bindUser= LDAP_AUTH_NTLM_DOMAIN + '\\' + username if (LDAP_AUTH_TYPE == 'NTLM') else username
        server = Server(LDAP_AUTH_SERVER, port=LDAP_AUTH_SERVER_PORT, use_ssl=LDAP_AUTH_USE_SSL, get_info=ALL) 
        connection = Connection(server=server, authentication=authType, read_only=True, user=bindUser, password=password)
        connection.bind()         
        print(f'LDAP bind: {connection.result["description"]}')  # "success" if bind is ok
        searchString = f'(&(objectclass={LDAP_USER_CLASS})({LDAP_USER_ID_ATTRIBUTE}={escape_filter_chars(username)}))'
        connection.search(LDAP_SEARCH_BASE, searchString, attributes=[LDAP_USER_NAME_ATTRIBUTE, LDAP_USER_GROUPS_ATTRIBUTE])
        if (len(connection.entries) != 1) :
             print(f'Unexpected number of Results on ldap query {len(connection.entries)}', file=sys.stderr, flush=True)
             return {'bind': False} 
        else :
            userInfo = connection.entries[0]
            userGroups = userInfo[LDAP_USER_GROUPS_ATTRIBUTE]
            groupMapping = next((x for x in LDAP_GROUP_MAP if x['ldapGroup'] in userGroups), None)
            if (groupMapping != None) :
                return {'bind': True, 'name': str(userInfo.name), 'warpGroup': groupMapping['warpGroup']}
            else :
                print("User not in Auth Groups: "+ username)
                return {'bind': False}
		
    except LDAPException as e:
        print("Error connecting to Server. User ("+username+"): " + str(e))
        return {'bind': False}
    except Exception as e:
        print("Error connecting to Server. User ("+username+"): " + str(e))
        traceback.print_exc()
        return {'bind': False}

def ldapLogin(login, password):
    if (password is None or login is None):
        return flask.abort(400)

    LDAP_USER_NAME_ATTRIBUTE = flask.current_app.config.get('LDAP_USER_NAME_ATTRIBUTE')
    userInfo=ldapValidateCredentials(login, password)
    # print("Results: "+(str(userInfo)))

    if userInfo['bind']:
        c = Users.select(Users.name).where(Users.login == login).scalar()
        if c is None:
            with DB.atomic():
                Users.insert({
                    Users.login: login,
                    Users.name: userInfo[LDAP_USER_NAME_ATTRIBUTE] ,
                    Users.account_type: ACCOUNT_TYPE_USER,
                    Users.password: 'Pass not here used LDAP bind'
                }).execute()

                defaultGroup = userInfo['warpGroup'] 
                if defaultGroup is not None:
                    Groups.insert({
                        Groups.group: defaultGroup,
                        Groups.login: login
                    }).execute()
        
        flask.session['login'] = login
        flask.session['login_time'] = utils.now()
        return True
    else:
        return False

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
        AUTH_LDAP =  True if flask.current_app.config.get('AUTH_LDAP') == 'true' else False
        LDAP_EXCLUDED_USERS=flask.current_app.config.get('LDAP_EXCLUDED_USERS') or []
        print (LDAP_EXCLUDED_USERS)
        if AUTH_LDAP and u not in LDAP_EXCLUDED_USERS :
            if ldapLogin(u,p) :
                return flask.redirect(flask.url_for('view.index'))
            else :
                flask.flash("Wrong username or password")
        else :
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
