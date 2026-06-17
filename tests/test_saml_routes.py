# Tests for the configurable SAML endpoint path (SAML_ENDPOINT_PATH) and the
# SSO-button open-redirect guard. These exercise blueprint registration and pure
# helpers only — no python3-saml / IdP needed.

import flask
import warp.auth_saml as saml


def _rules(app):
    return {r.endpoint: str(r) for r in app.url_map.iter_rules()}


def _app(endpoint_path=None):
    app = flask.Flask(__name__)
    if endpoint_path is not None:
        app.config['SAML_ENDPOINT_PATH'] = endpoint_path
    app.register_blueprint(saml.bp)
    return app


def test_default_endpoint_path():
    rules = _rules(_app())
    assert rules['auth.saml_login'] == '/saml/login'
    assert rules['auth.saml_acs'] == '/saml/acs'
    assert rules['auth.saml_metadata'] == '/saml/metadata'
    assert rules['auth.saml_sls'] == '/saml/sls'
    # generic entry points stay at the root, like the other backends
    assert rules['auth.login'] == '/login'
    assert rules['auth.logout'] == '/logout'


def test_custom_endpoint_path():
    rules = _rules(_app('/sp'))
    assert rules['auth.saml_acs'] == '/sp/acs'
    assert rules['auth.saml_sls'] == '/sp/sls'
    assert rules['auth.saml_metadata'] == '/sp/metadata'
    assert rules['auth.saml_login'] == '/sp/login'
    assert rules['auth.login'] == '/login'


def test_endpoint_path_normalised():
    # missing leading slash and trailing slash are tolerated
    rules = _rules(_app('sp/'))
    assert rules['auth.saml_acs'] == '/sp/acs'


def test_nested_endpoint_path():
    rules = _rules(_app('/auth/saml'))
    assert rules['auth.saml_acs'] == '/auth/saml/acs'


def test_acs_is_post_only():
    app = _app()
    rule = next(r for r in app.url_map.iter_rules() if r.endpoint == 'auth.saml_acs')
    assert 'POST' in rule.methods
    assert 'GET' not in rule.methods


def test_is_safe_redirect():
    app = flask.Flask(__name__)
    with app.test_request_context(base_url="http://localhost:8000/"):
        assert saml._isSafeRedirect('/') is True
        assert saml._isSafeRedirect('/bookings') is True
        assert saml._isSafeRedirect('http://localhost:8000/x') is True
        # cross-origin and obfuscation attempts are rejected
        assert saml._isSafeRedirect('https://evil.com/x') is False
        assert saml._isSafeRedirect('http://evil.com') is False
        assert saml._isSafeRedirect('//evil.com') is False
        assert saml._isSafeRedirect('/\\evil.com') is False
        assert saml._isSafeRedirect('') is False
        assert saml._isSafeRedirect(None) is False
