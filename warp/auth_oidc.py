import flask
import sys
from urllib.parse import quote
from warp.db import *
import warp.auth
from . import utils

bp = flask.Blueprint('auth', __name__)

# ---------------------------------------------------------------------------
# OIDC client (Authlib)
# ---------------------------------------------------------------------------

_oauth = None

def _get_oauth():
    """Lazy-initialise the Authlib OAuth registry on first use."""
    global _oauth
    if _oauth is not None:
        return _oauth

    from authlib.integrations.flask_client import OAuth

    _oauth = OAuth(flask.current_app)
    _oauth.register(
        name="oidc",
        server_metadata_url=flask.current_app.config['OIDC_DISCOVERY_URL'],
        client_id=flask.current_app.config['OIDC_CLIENT_ID'],
        client_secret=flask.current_app.config.get('OIDC_CLIENT_SECRET'),
        client_kwargs={
            "scope": flask.current_app.config.get('OIDC_SCOPES', 'openid profile email'),
            "code_challenge_method": "S256",
        },
    )
    return _oauth


# ---------------------------------------------------------------------------
# Claim → metadata mapping
# ---------------------------------------------------------------------------

def oidcGetUserMetadata(claims):
    """Map OIDC claims to a WARP user-metadata dict, applying group-map
    access control (same semantics as LDAP's ldapGetUserMetadata).

    Returns None when the user has no matching group and no [null,null] entry
    (deny access).
    """
    config = flask.current_app.config

    login_claim = config.get('OIDC_LOGIN_ATTRIBUTE', 'preferred_username')
    name_claim = config.get('OIDC_USER_NAME_ATTRIBUTE', 'name')
    groups_claim = config.get('OIDC_GROUPS_CLAIM', 'groups')

    login = claims.get(login_claim)
    if not login:
        print("OIDC WARNING: login claim missing from ID token", file=sys.stderr, flush=True)
        return None

    userName = claims.get(name_claim, login)
    idpGroups = claims.get(groups_claim, []) or []
    groupMap = config.get('OIDC_GROUP_MAP', [[None, None]])

    return warp.auth.buildUserMetadata(login, userName, idpGroups, groupMap)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@bp.route('/login', methods=['GET', 'POST'])
def login():
    """OIDC login entry point.

    When OIDC_EXCLUDED_USERS is empty (default), /login immediately redirects
    to the IdP — clean SSO-only experience.

    When OIDC_EXCLUDED_USERS is non-empty, /login renders the local
    username/password form plus a "Sign in with SSO" button that links to
    /oidc/start. A POST to /login is handled by the local warp.auth.login()
    logic, but only for logins present in OIDC_EXCLUDED_USERS.
    """
    # Clear session to force re-login (same as other backends)
    flask.session.clear()

    excluded_users = flask.current_app.config.get('OIDC_EXCLUDED_USERS', [])

    # --- SSO-only path: redirect straight to IdP --------------------------
    if not excluded_users:
        return _start_oidc_flow()

    # --- Mixed path: local form + SSO button ------------------------------
    if flask.request.method == 'POST':
        u = flask.request.form.get('login')

        if u not in excluded_users:
            flask.flash("Please sign in with SSO")
        else:
            # Delegate to local password auth for excluded users
            return warp.auth.login()

        return flask.render_template('login.html', sso_enabled=True,
                                       sso_start_url=flask.url_for('auth.oidc_start'))

    return flask.render_template('login.html', sso_enabled=True,
                                   sso_start_url=flask.url_for('auth.oidc_start'))


@bp.route('/oidc/start')
def oidc_start():
    """Dedicated route for the "Sign in with SSO" button (used when
    OIDC_EXCLUDED_USERS is non-empty and the local form is shown)."""
    flask.session.clear()
    return _start_oidc_flow()


@bp.route('/oidc/callback')
def oidc_callback():
    """OIDC callback — exchanges the auth code for tokens, verifies the ID
    token, extracts claims, and provisions the user."""
    config = flask.current_app.config
    app_root_uri = flask.url_for('view.index')

    try:
        oauth = _get_oauth()
        token = oauth.oidc.authorize_access_token()
    except Exception as e:
        print(f"OIDC WARNING: token exchange failed: {e}", file=sys.stderr, flush=True)
        return flask.render_template("auth_error.html",
            error="token_exchange_failed",
            application_root_uri=app_root_uri)

    # Authlib parses and verifies the ID token (iss, aud, exp, nonce, signature).
    claims = token.get('userinfo')

    # Store the raw ID token for RP-initiated logout (before any early return)
    id_token = token.get('id_token')
    if id_token:
        flask.session['oidc_id_token'] = id_token

    # Optionally call the UserInfo endpoint and merge claims
    if config.get('OIDC_USERINFO'):
        try:
            userinfo = oauth.oidc.userinfo()
            if userinfo:
                # Merge userinfo claims on top (userinfo takes precedence)
                merged = dict(claims) if claims else {}
                merged.update(userinfo)
                claims = merged
        except Exception as e:
            print(f"OIDC WARNING: userinfo endpoint failed: {e}", file=sys.stderr, flush=True)

    if not claims:
        return flask.render_template("auth_error.html",
            error="no_claims",
            application_root_uri=app_root_uri)

    metadata = oidcGetUserMetadata(claims)
    if metadata is None:
        return flask.render_template("auth_error.html",
            error="access_denied",
            application_root_uri=app_root_uri)

    strictMapping = config.get('OIDC_GROUP_STRICT_MAPPING', False)
    login = warp.auth.applyUserMetadata(
        metadata['login'], metadata,
        strictMapping=strictMapping,
        warnPrefix="OIDC")

    flask.session['login'] = login
    flask.session['login_time'] = utils.now(tz="UTC")

    return flask.redirect(app_root_uri)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _start_oidc_flow():
    """Begin the OIDC redirect flow (authorize_redirect)."""
    config = flask.current_app.config
    oauth = _get_oauth()
    redirect_uri = flask.url_for('.oidc_callback', _external=True,
                                  _scheme=config.get('OIDC_HTTPS_SCHEME', 'https'))
    return oauth.oidc.authorize_redirect(redirect_uri)


# ---------------------------------------------------------------------------
# Logout & session gate
# ---------------------------------------------------------------------------

def logout():
    config = flask.current_app.config
    id_token = flask.session.pop('oidc_id_token', None)
    flask.session.clear()

    # RP-initiated logout: redirect to the IdP's end_session_endpoint
    # so the user is also logged out from the IdP (e.g. Keycloak).
    try:
        oauth = _get_oauth()
        end_session_endpoint = oauth.oidc.load_server_metadata().get('end_session_endpoint')
    except Exception:
        end_session_endpoint = None

    if end_session_endpoint:
        logout_uri = flask.url_for('auth.login', _external=True,
                                    _scheme=config.get('OIDC_HTTPS_SCHEME', 'https'))
        params = ['post_logout_redirect_uri=' + quote(logout_uri, safe='')]
        if id_token:
            params.append('id_token_hint=' + quote(id_token, safe=''))
        return flask.redirect(end_session_endpoint + '?' + '&'.join(params))

    return flask.redirect(flask.url_for('auth.login'))

bp.route('/logout')(logout)
bp.before_app_request(warp.auth.session)
