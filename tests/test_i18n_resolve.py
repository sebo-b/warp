# Pure tests for the language resolver (warp/i18n.py):
#  - resolve(): the precedence rule (prefs > cookie > default for logged-in;
#    cookie > default otherwise; invalid values fall through to default).
#  - language_menu(): sorted by endonym.
#  - lang_aria_for(): the server-rendered aria label per locale.
#
# No DB, no request context for resolve() itself (it is pure); a Flask app is
# built only so configured_languages()/language_menu() can read the cached meta.
#
# Run with:  python -m pytest tests/test_i18n_resolve.py

import pytest

import warp
from warp import i18n


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv('FLASK_DEBUG', '1')
    monkeypatch.setenv('WARP_LANGUAGES', '["en","de","fr","es","pl"]')
    monkeypatch.setenv('WARP_DEFAULT_LANGUAGE', 'en')
    return warp.create_app()


def test_resolve_prefs_beats_cookie(app):
    # logged-in: a non-NULL pref wins over a stale cookie (shared device)
    with app.app_context():
        assert i18n.resolve('de', 'fr', 'en') == 'fr'


def test_resolve_cookie_when_no_pref(app):
    with app.app_context():
        assert i18n.resolve('de', None, 'en') == 'de'


def test_resolve_default_when_nothing_valid(app):
    with app.app_context():
        assert i18n.resolve(None, None, 'en') == 'en'
        assert i18n.resolve('xx', None, 'en') == 'en'      # invalid cookie -> default
        assert i18n.resolve('de', 'zz', 'en') == 'de'      # invalid pref -> valid cookie
        assert i18n.resolve(None, 'zz', 'en') == 'en'      # invalid pref, no cookie -> default


def test_resolve_pref_not_in_configured_ignored(app):
    with app.app_context():
        # 'it' has no locale file / not in LANGUAGES -> ignored, cookie wins
        assert i18n.resolve('de', 'it', 'en') == 'de'


def test_language_menu_sorted_by_endonym(app):
    with app.app_context():
        codes = [m['code'] for m in i18n.language_menu('en')]
        # sorted by name: Deutsch, English, Español, Français, Polski
        assert codes == ['de', 'en', 'es', 'fr', 'pl']
        active = [m for m in i18n.language_menu('fr') if m['active']]
        assert [m['code'] for m in active] == ['fr']


def test_lang_aria_uses_each_locales_language_phrase(app):
    with app.app_context():
        assert i18n.lang_aria_for('en') == 'Language'
        assert i18n.lang_aria_for('de') == 'Sprache'
        assert i18n.lang_aria_for('pl') == 'Język'