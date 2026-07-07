# Config + startup-validation tests for the language settings (warp/config.py,
# warp/i18n.py):
#  - WARP_LANGUAGES parses a JSON array; the bare comma form aborts.
#  - i18n.init_app validates: DEFAULT_LANGUAGE must be in LANGUAGES; every code
#    must have a locale file with the name/flag metadata fields; a missing
#    flag file aborts.
#
# No DB. Uses the real static folder so the shipped locale files/flags resolve.
#
# Run with:  python -m pytest tests/test_config_languages.py

import pytest

import warp
from warp import i18n


@pytest.fixture
def make_app(monkeypatch):
    def make(**env):
        monkeypatch.setenv('FLASK_DEBUG', '1')
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        return warp.create_app()
    return make


def test_languages_json_array_parses(make_app):
    app = make_app(WARP_LANGUAGES='["en","de"]', WARP_DEFAULT_LANGUAGE='en')
    assert app.config['LANGUAGES'] == ['en', 'de']
    assert app.config['DEFAULT_LANGUAGE'] == 'en'
    assert sorted(app.extensions['warp_i18n']) == ['de', 'en']


def test_comma_form_aborts(make_app):
    with pytest.raises(Exception):
        make_app(WARP_LANGUAGES='en,de')


def test_default_not_in_languages_aborts(make_app):
    with pytest.raises(ValueError):
        make_app(WARP_LANGUAGES='["en","de"]', WARP_DEFAULT_LANGUAGE='fr')


def test_code_without_locale_file_aborts(make_app):
    with pytest.raises(ValueError):
        make_app(WARP_LANGUAGES='["en","zz"]', WARP_DEFAULT_LANGUAGE='en')


def test_locale_file_missing_metadata_aborts(tmp_path, monkeypatch):
    # Build a minimal app whose static dir has an en.json WITHOUT the new
    # name/flag fields -> init_app must abort.
    import json, os
    static = tmp_path / 'static'
    (static / 'i18n').mkdir(parents=True)
    (static / 'images' / 'flags').mkdir(parents=True)
    (static / 'i18n' / 'en.json').write_text(json.dumps({
        'locale': 'en', 'phrases': {'Language': 'Language'}
    }))
    monkeypatch.setenv('FLASK_DEBUG', '1')
    monkeypatch.setenv('WARP_LANGUAGES', '["en"]')
    monkeypatch.setenv('WARP_DEFAULT_LANGUAGE', 'en')
    import flask
    app = flask.Flask(__name__, static_folder=str(static))
    from warp.config import initConfig
    initConfig(app)
    with pytest.raises(ValueError):
        i18n.init_app(app)


def test_missing_flag_file_aborts(tmp_path, monkeypatch):
    import json
    static = tmp_path / 'static'
    (static / 'i18n').mkdir(parents=True)
    (static / 'images' / 'flags').mkdir(parents=True)
    (static / 'i18n' / 'en.json').write_text(json.dumps({
        'locale': 'en', 'name': 'English', 'flag': 'missing.svg',
        'phrases': {'Language': 'Language'}
    }))
    monkeypatch.setenv('FLASK_DEBUG', '1')
    monkeypatch.setenv('WARP_LANGUAGES', '["en"]')
    monkeypatch.setenv('WARP_DEFAULT_LANGUAGE', 'en')
    import flask
    app = flask.Flask(__name__, static_folder=str(static))
    from warp.config import initConfig
    initConfig(app)
    with pytest.raises(ValueError):
        i18n.init_app(app)