import flask
import sys

from warp.db import *
import warp.auth
from . import utils

bp = flask.Blueprint('auth', __name__)

# ---------------------------------------------------------------------------
# SAML settings builder (python3-saml)
# ---------------------------------------------------------------------------

_idp_metadata_cache = None


def _buildSamlSettings():
    """Assemble the python3-saml settings dict from WARP configuration."""
    config = flask.current_app.config
    https_scheme = config.get('SAML_HTTPS_SCHEME', 'https')

    sp_entity_id = config.get('SAML_SP_ENTITY_ID', '')
    acs_url = flask.url_for('.saml_acs', _external=True, _scheme=https_scheme)
    sls_url = flask.url_for('.saml_sls', _external=True, _scheme=https_scheme)

    sp_settings = {
        'entityId': sp_entity_id,
        'assertionConsumerService': {
            'url': acs_url,
            'binding': 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
        },
        'singleLogoutService': {
            'url': sls_url,
            'binding': 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
        },
        'NameIDFormat': config.get('SAML_NAMEID_FORMAT',
            'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified'),
    }

    sp_cert = config.get('SAML_SP_X509_CERT')
    sp_key = config.get('SAML_SP_PRIVATE_KEY')
    if sp_cert:
        sp_settings['x509cert'] = sp_cert
    if sp_key:
        sp_settings['privateKey'] = sp_key

    # Build IdP settings — prefer metadata URL (discovery), fall back to manual
    idp_settings = {}

    metadata_url = config.get('SAML_IDP_METADATA_URL')
    if metadata_url:
        global _idp_metadata_cache
        if _idp_metadata_cache is None:
            from onelogin.saml2.idp_metadata_parser import OneLogin_Saml2_IdPMetadataParser
            _idp_metadata_cache = OneLogin_Saml2_IdPMetadataParser.parse_remote(
                metadata_url,
                validate_cert=(https_scheme == 'https'),
            )
        if _idp_metadata_cache:
            idp_settings = _idp_metadata_cache.get('idp', {})
    else:
        idp_entity_id = config.get('SAML_IDP_ENTITY_ID', '')
        idp_sso_url = config.get('SAML_IDP_SSO_URL', '')
        idp_slo_url = config.get('SAML_IDP_SLO_URL', '')
        idp_cert = config.get('SAML_IDP_X509_CERT', '')

        idp_settings = {
            'entityId': idp_entity_id,
            'singleSignOnService': {
                'url': idp_sso_url,
                'binding': 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
            },
        }
        if idp_slo_url:
            idp_settings['singleLogoutService'] = {
                'url': idp_slo_url,
                'binding': 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
            }
        if idp_cert:
            idp_settings['x509cert'] = idp_cert

    security_settings = {
        'authnRequestsSigned': config.get('SAML_AUTHN_REQUESTS_SIGNED', False),
        'wantAssertionsSigned': config.get('SAML_WANT_ASSERTIONS_SIGNED', True),
        'wantMessagesSigned': config.get('SAML_WANT_MESSAGES_SIGNED', False),
        # Allow duplicate attribute names — some IdPs (Keycloak) send the
        # same attribute twice due to built-in + custom mappers.
        'allowRepeatAttributeName': True,
    }

    return {
        'strict': True,
        'debug': False,
        'sp': sp_settings,
        'idp': idp_settings,
        'security': security_settings,
    }


def _prepareFlaskRequest():
    """Build the request dict python3-saml expects from flask.request."""
    config = flask.current_app.config
    https_scheme = config.get('SAML_HTTPS_SCHEME', 'https')

    url_data = flask.request.url.split('?')
    return {
        'https': 'on' if https_scheme == 'https' else 'off',
        'http_host': flask.request.host,
        'script_name': flask.request.path,
        'get_data': flask.request.args,
        'post_data': flask.request.form,
        # Lower-level key used by some python3-saml versions
        'request_uri': flask.request.url,
    }


# ---------------------------------------------------------------------------
# Attribute → metadata mapping
# ---------------------------------------------------------------------------

def _firstAttr(attributes, name):
    """Extract the first value of a SAML attribute.

    python3-saml returns attribute values as lists; this helper returns
    the first element, or None if the attribute is absent or empty.
    """
    values = attributes.get(name, [])
    if values:
        return values[0]
    return None


def samlGetUserMetadata(nameid, attributes):
    """Map SAML assertion NameID/attributes to a WARP user-metadata dict,
    applying group-map access control (same semantics as LDAP/OIDC).

    Returns None when the user has no matching group and no [null,null] entry
    (deny access).
    """
    config = flask.current_app.config

    loginAttr = config.get('SAML_LOGIN_ATTRIBUTE', '')
    login = _firstAttr(attributes, loginAttr) if loginAttr else nameid

    if not login:
        print("SAML WARNING: login attribute/NameID missing", file=sys.stderr, flush=True)
        return None

    userName = _firstAttr(attributes, config.get('SAML_USER_NAME_ATTRIBUTE', 'cn')) or login
    idpGroups = attributes.get(config.get('SAML_GROUPS_ATTRIBUTE', 'groups'), []) or []

    return warp.auth.buildUserMetadata(
        login, userName, idpGroups,
        config.get('SAML_GROUP_MAP', [[None, None]]))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@bp.route('/login', methods=['GET', 'POST'])
def login():
    """SAML login entry point.

    When SAML_EXCLUDED_USERS is empty (default), /login immediately redirects
    to the IdP — clean SSO-only experience.

    When SAML_EXCLUDED_USERS is non-empty, /login renders the local
    username/password form plus a "Sign in with SSO" button that links to
    /saml/login. A POST to /login is handled by the local warp.auth.login()
    logic, but only for logins present in SAML_EXCLUDED_USERS.
    """
    # Clear session to force re-login (same as other backends)
    flask.session.clear()

    excluded_users = flask.current_app.config.get('SAML_EXCLUDED_USERS', [])

    # --- SSO-only path: redirect straight to IdP --------------------------
    if not excluded_users:
        return _start_saml_flow()

    # --- Mixed path: local form + SSO button ------------------------------
    if flask.request.method == 'POST':
        u = flask.request.form.get('login')

        if u not in excluded_users:
            flask.flash("Please sign in with SSO")
        else:
            # Delegate to local password auth for excluded users
            return warp.auth.login()

        return flask.render_template('login.html', sso_enabled=True,
                                     sso_start_url=flask.url_for('.saml_login'))

    return flask.render_template('login.html', sso_enabled=True,
                                 sso_start_url=flask.url_for('.saml_login'))


@bp.route('/saml/login')
def saml_login():
    """Dedicated route for the "Sign in with SSO" button (used when
    SAML_EXCLUDED_USERS is non-empty and the local form is shown).
    Also used by the empty-excluded-users redirect path."""
    flask.session.clear()
    return _start_saml_flow()


@bp.route('/saml/acs', methods=['POST'])
def saml_acs():
    """SAML Assertion Consumer Service — processes the IdP response."""
    config = flask.current_app.config
    app_root_uri = flask.url_for('view.index')

    from onelogin.saml2.auth import OneLogin_Saml2_Auth

    req = _prepareFlaskRequest()
    auth = OneLogin_Saml2_Auth(req, _buildSamlSettings())

    auth.process_response()
    errors = auth.get_errors()

    if errors or not auth.is_authenticated():
        reason = ', '.join(errors) if errors else 'not authenticated'
        last_reason = auth.get_last_error_reason()
        print(f"SAML WARNING: invalid response: {reason}"
              f"{(' — ' + last_reason) if last_reason else ''}",
              file=sys.stderr, flush=True)
        return flask.render_template("auth_error.html",
            error="invalid_response",
            application_root_uri=app_root_uri)

    nameid = auth.get_nameid()
    attributes = auth.get_attributes()
    session_index = auth.get_session_index()

    metadata = samlGetUserMetadata(nameid, attributes)
    if metadata is None:
        return flask.render_template("auth_error.html",
            error="access_denied",
            application_root_uri=app_root_uri)

    strictMapping = config.get('SAML_GROUP_STRICT_MAPPING', False)
    login = warp.auth.applyUserMetadata(
        metadata['login'], metadata,
        strictMapping=strictMapping,
        warnPrefix="SAML")

    flask.session['login'] = login
    flask.session['login_time'] = utils.now()

    # Save SLO data for SP-initiated logout
    flask.session['saml_nameid'] = nameid
    if session_index:
        flask.session['saml_session_index'] = session_index

    # RelayState from the IdP (or redirect to the app root)
    relay_state = flask.request.form.get('RelayState')
    if relay_state:
        return flask.redirect(relay_state)

    return flask.redirect(app_root_uri)


@bp.route('/saml/metadata')
def saml_metadata():
    """Serve the SP metadata XML so admins can register the SP at the IdP."""
    from onelogin.saml2.settings import OneLogin_Saml2_Settings

    try:
        settings = OneLogin_Saml2_Settings(_buildSamlSettings())
        metadata_xml = settings.get_sp_metadata()
        errors = settings.validate_metadata(metadata_xml)
        if errors:
            for e in errors:
                print(f"SAML WARNING: SP metadata validation error: {e}",
                      file=sys.stderr, flush=True)
            return "Invalid SP metadata configuration", 500
        return flask.Response(metadata_xml, content_type='text/xml')
    except Exception as e:
        print(f"SAML WARNING: could not generate SP metadata: {e}",
              file=sys.stderr, flush=True)
        return "Could not generate SP metadata", 500


@bp.route('/saml/sls')
def saml_sls():
    """SAML Single Logout Service — processes the IdP logout response/request."""
    from onelogin.saml2.auth import OneLogin_Saml2_Auth

    req = _prepareFlaskRequest()
    auth = OneLogin_Saml2_Auth(req, _buildSamlSettings())

    # process_slo handles both logout request and response
    auth.process_slo(delete_session_cb=lambda: flask.session.clear())

    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _start_saml_flow():
    """Begin the SAML redirect flow (SP-initiated SSO)."""
    from onelogin.saml2.auth import OneLogin_Saml2_Auth

    config = flask.current_app.config
    req = _prepareFlaskRequest()
    auth = OneLogin_Saml2_Auth(req, _buildSamlSettings())

    return_to = flask.url_for('view.index', _external=True,
                              _scheme=config.get('SAML_HTTPS_SCHEME', 'https'))
    return flask.redirect(auth.login(return_to=return_to))


# ---------------------------------------------------------------------------
# Logout & session gate
# ---------------------------------------------------------------------------

def logout():
    config = flask.current_app.config

    # If the IdP has an SLO endpoint, try SP-initiated SLO
    slo_configured = (config.get('SAML_IDP_METADATA_URL')
                      or config.get('SAML_IDP_SLO_URL'))

    if slo_configured:
        try:
            from onelogin.saml2.auth import OneLogin_Saml2_Auth

            req = _prepareFlaskRequest()
            auth = OneLogin_Saml2_Auth(req, _buildSamlSettings())

            name_id = flask.session.pop('saml_nameid', None)
            session_index = flask.session.pop('saml_session_index', None)

            flask.session.clear()

            # Build a logout request redirecting back to the SLS endpoint
            return flask.redirect(
                auth.logout(name_id=name_id,
                            session_index=session_index,
                            return_to=flask.url_for('.saml_sls', _external=True,
                                _scheme=config.get('SAML_HTTPS_SCHEME', 'https'))))
        except Exception as e:
            print(f"SAML WARNING: could not initiate SLO: {e}",
                  file=sys.stderr, flush=True)
            flask.session.clear()
            return flask.redirect(flask.url_for('auth.login'))

    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))

bp.route('/logout')(logout)
bp.before_app_request(warp.auth.session)
