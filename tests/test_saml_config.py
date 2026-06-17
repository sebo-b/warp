# Tests for the SAML-related configuration plumbing added for mod_auth_mellon
# parity: IdP metadata-from-file, session-cookie SameSite/Secure, and the
# configurable endpoint path.

import flask
from warp import config


def test_idp_metadata_file_loads_into_metadata(tmp_path, monkeypatch):
    """WARP_SAML_IDP_METADATA_FILE reads the XML into SAML_IDP_METADATA
    (the _FILE convention), stripping one trailing newline."""
    f = tmp_path / "idp-metadata.xml"
    f.write_text("<EntityDescriptor>meta</EntityDescriptor>\n")
    # isolate: only our var should be read
    for k in list(__import__('os').environ):
        if k.startswith('WARP_'):
            monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("WARP_SAML_IDP_METADATA_FILE", str(f))

    app = flask.Flask(__name__)
    config.readEnvironmentSettings(app)

    assert app.config['SAML_IDP_METADATA'] == "<EntityDescriptor>meta</EntityDescriptor>"
    assert 'SAML_IDP_METADATA_FILE' not in app.config


def test_session_cookie_settings_registered():
    assert config._ENV_SETTINGS['SESSION_COOKIE_SAMESITE'] is config._fmt_str
    assert config._ENV_SETTINGS['SESSION_COOKIE_SECURE'] is config._fmt_bool


def test_saml_endpoint_and_metadata_settings_registered():
    assert config._ENV_SETTINGS['SAML_ENDPOINT_PATH'] is config._fmt_str
    assert config._ENV_SETTINGS['SAML_IDP_METADATA'] is config._fmt_str
    assert config._ENV_SETTINGS['SAML_IDP_METADATA_FILE'] is config._fmt_file


def test_endpoint_path_default():
    from warp.config import DefaultSettings
    assert DefaultSettings.SAML_ENDPOINT_PATH == "/saml"
