import flask
from werkzeug.security import check_password_hash
from warp.db import *
import warp.auth
from . import utils
from ldap3 import Server, Connection, ALL, Tls
import ssl
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
from ldap3.utils.dn import escape_rdn
import ldap3
import sys

bp = flask.Blueprint('auth', __name__)

def ldapConnect(login, password):

    validateCert = flask.current_app.config.get('LDAP_VALIDATE_CERT',None)
    tlsVersion = flask.current_app.config.get('LDAP_TLS_VERSION',None)
    tlsCiphers = flask.current_app.config.get('LDAP_TLS_CIPHERS',None)

    tls_params = {}
    if validateCert is not None:
        tls_params['validate'] = ssl.CERT_REQUIRED if validateCert else ssl.CERT_NONE
    if tlsVersion is not None:
        if tlsVersion == "TLSv1": tls_params['version'] = ssl.PROTOCOL_TLSv1
        elif tlsVersion == "TLSv1.1": tls_params['version'] = ssl.PROTOCOL_TLSv1_1
        elif tlsVersion == "TLSv1.2": tls_params['version'] = ssl.PROTOCOL_TLSv1_2
        else: print(f"Wrong TLS version specified {tlsVersion}",file=sys.stderr)
    if tlsCiphers is not None:
        tls_params["ciphers"] = tlsCiphers

    tls = None
    if tls_params:
        tls = ldap3.Tls(**tls_params)

    url = flask.current_app.config.get('LDAP_SERVER_URL')
    if not url.lower().startswith('ldap://') and not url.lower().startswith('ldaps://'):
        print(f"LDAP_SERVER_URL must be either ldap:// or ldaps:// specified: {url}",file=sys.stderr)
        raise Exception("LDAP_SERVER_URL must be either ldap:// or ldaps://")
    ldapServer = ldap3.Server(url,tls=tls,get_info=ALL)

    userName = flask.current_app.config.get("LDAP_USER_TEMPLATE")
    userName = userName.format(login=escape_rdn(login))

    ldapAuthType = flask.current_app.config.get('LDAP_AUTH_TYPE')
    if ldapAuthType.upper() == "SIMPLE":
        ldapAuthType = ldap3.SIMPLE
    elif ldapAuthType.upper() == "NTLM":
        ldapAuthType = ldap3.NTLM
        if '\\' not in userName:
            print("For NTLM authentication LDAP_USER_TEMPLATE should contain Domain name.",file=sys.stderr)
    else:
        print(f"Wrong LDAP_AUTH_TYPE specified {ldapAuthType}",file=sys.stderr)
        raise Exception("Wrong LDAP_AUTH_TYPE specified")

    if '\\' in userName and not flask.current_app.config.get("LDAP_USER_SEARCH_BASE",None):
        print("For AD authentication LDAP_USER_SEARCH_BASE should be configured.",file=sys.stderr)

    ldapConnection = ldap3.Connection(
        ldapServer,
        authentication=ldapAuthType,
        lazy=False,
        read_only=True,
        auto_bind=ldap3.AUTO_BIND_NONE,
        user=userName,
        password=password)

    if flask.current_app.config.get('LDAP_STARTTLS') and url.lower().startswith('ldap://'):
        ldapConnection.start_tls()

    if not ldapServer.ssl and not ldapConnection.tls_started:
        print("WARNING: Non-secure LDAP connection used")

    if not ldapConnection.bind():
        return None

    return ldapConnection

def ldapGetUserMetadata(login,ldapConnection):


    userSearchBase = flask.current_app.config.get("LDAP_USER_SEARCH_BASE",None)
    if not userSearchBase:
        userSearchBase = flask.current_app.config.get("LDAP_USER_TEMPLATE","")
    userSearchBase = userSearchBase.format(login=escape_rdn(login))

    userSearchFilter = flask.current_app.config.get("LDAP_USER_SEARCH_FILTER_TEMPLATE","")
    userSearchFilter = userSearchFilter.format(login=escape_rdn(login))

    # LDAP_USER_NAME_ATTRIBUTE is a single attribute name or a list of them; we
    # request them all and join the ones present on the entry below.
    ldapNameAtt = flask.current_app.config.get('LDAP_USER_NAME_ATTRIBUTE')
    if isinstance(ldapNameAtt, str):
        ldapNameAtt = [ldapNameAtt]
    ldapConnection.search(search_base=userSearchBase,
                          search_filter=userSearchFilter,
                          attributes=ldapNameAtt)

    if len(ldapConnection.entries) != 1:
        raise Exception(f"LDAP: Wrong number of enties returned for the user: {len(ldapConnection.entries)}")

    entry = ldapConnection.entries[0]
    # Join the attributes that are present, falling back to the login when none
    # resolve (consistent with the OIDC/SAML backends).
    userName = ' '.join(str(entry[a].value) for a in ldapNameAtt if a in entry) or login

    ret = {
        "userName": userName,
        "groups": []
    }

    searchBase = flask.current_app.config.get('LDAP_GROUP_SEARCH_BASE', None)
    if searchBase is None:
        return ret

    loginAllowed = False
    searchFilterTemplate = flask.current_app.config.get('LDAP_GROUP_SEARCH_FILTER_TEMPLATE')
    ldapGroupMap = flask.current_app.config.get('LDAP_GROUP_MAP')
    for ldapGroup,warpGroup in ldapGroupMap:

        if ldapGroup is None and warpGroup is None:
            loginAllowed = True
            continue

        if ldapGroup is None:
            ret["groups"].append(warpGroup)
            continue

        searchFilter = searchFilterTemplate.format(group=escape_filter_chars(ldapGroup),login=escape_filter_chars(login))
        ldapConnection.search(search_base=searchBase,search_filter=searchFilter)

        if len(ldapConnection.entries) == 0:
            continue
        elif len(ldapConnection.entries) > 1:
            print("LDAP group search returned more than one entry. Probably LDAP_GROUP_SEARCH_FILTER is wrongly defined.",file=sys.stderr)

        loginAllowed = True
        if warpGroup:
            ret["groups"].append(warpGroup)

    if not loginAllowed:
        return None

    return ret

def ldapApplyUserMetadata(login,userData):

    strictMapping = flask.current_app.config.get('LDAP_GROUP_STRICT_MAPPING')
    return warp.auth.applyUserMetadata(
        login, userData,
        strictMapping=strictMapping,
        warnPrefix="LDAP")



def ldapLogin(login, password):

    if password is None or login is None:
        return flask.abort(400)

    connection = ldapConnect(login,password)
    if not connection:
        return False

    userMetadata = ldapGetUserMetadata(login,connection)
    if not userMetadata:
        return False

    login = ldapApplyUserMetadata(login,userMetadata)

    flask.session['login'] = login
    flask.session['login_time'] = utils.now(tz="UTC")

    return True


@bp.route('/login', methods=['GET', 'POST'])
def login():

    # clear session to force re-login
    flask.session.clear()

    if flask.request.method == 'POST':

        u = flask.request.form.get('login')
        p = flask.request.form.get('password')

        LDAP_EXCLUDED_USERS = flask.current_app.config.get('LDAP_EXCLUDED_USERS', [])

        if u not in LDAP_EXCLUDED_USERS:

            if ldapLogin(u, p):
                return flask.redirect(flask.url_for('view.index'))
            flask.flash("Wrong username or password")

        else:
            return warp.auth.login()

    return flask.render_template('login.html')


bp.route('/logout')(warp.auth.logout)
bp.before_app_request(warp.auth.session)
