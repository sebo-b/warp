# DB-backed tests for the language prefs XHR (warp/xhr/prefs.py) and the
# bootstrap cookie/prefs sync (warp/xhr/bootstrap.py).
#
# They use the live dev DB (DevelopmentSettings -> 127.0.0.1:5432) the same way
# tests/test_pwa.py does, but create a throwaway user so they never mutate
# sample-data state. Run with:  python -m pytest tests/test_prefs_language.py

import secrets

import pytest

import warp
import warp.db as dbmod
from warp.db import Users, UserPrefs

LOGIN = f'langtest_{secrets.token_hex(4)}'


def _sql(stmt, args=()):
    """Run raw SQL in a short-lived connection so it never leaves an open
    connection that would clash with a subsequent test_client request
    (peewee: 'Connection already opened')."""
    dbmod.DB.connect(reuse_if_open=True)
    try:
        return dbmod.DB.execute_sql(stmt, args)
    finally:
        dbmod.DB.close()


def _pref_lang(login):
    row = _sql("SELECT language FROM user_prefs WHERE login=%s", (login,)).fetchone()
    return None if row is None else row[0]


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv('FLASK_DEBUG', '1')
    monkeypatch.setenv('WARP_LANGUAGES', '["en","de","fr"]')
    monkeypatch.setenv('WARP_DEFAULT_LANGUAGE', 'en')
    a = warp.create_app()
    from werkzeug.security import generate_password_hash
    dbmod.DB.connect(reuse_if_open=True)
    try:
        Users.insert({
            Users.login: LOGIN,
            Users.password: generate_password_hash('x'),
            Users.name: 'Lang Test',
            Users.account_type: 20,
        }).execute()
    finally:
        dbmod.DB.close()
    yield a
    dbmod.DB.connect(reuse_if_open=True)
    try:
        UserPrefs.delete().where(UserPrefs.login == LOGIN).execute()
        Users.delete().where(Users.login == LOGIN).execute()
    finally:
        dbmod.DB.close()


def _login(c):
    assert c.post('/login', data={'login': LOGIN, 'password': 'x'}).status_code == 302


def _payload(language):
    return {
        'default_day': 'same',
        'default_time': [9 * 3600, 17 * 3600],
        'zone_show_seat_names': False,
        'zone_show_booking_preview': False,
        'zone_show_assigned_names': False,
        'language': language,
    }


def test_prefs_get_language_none_when_no_row(app):
    with app.test_client() as c:
        _login(c)
        assert c.get('/xhr/prefs').get_json()['language'] is None


def test_prefs_get_coerces_stale_stored_language(app):
    # #1: a stored language no longer in LANGUAGES must read back as None, so a
    # later prefs save (even of unrelated toggles) doesn't POST it back and hit
    # the runtime 400 gate (no UI recovery on a single-language deployment).
    with app.test_client() as c:
        _login(c)
        _sql("INSERT INTO user_prefs(login, language) VALUES(%s,%s) "
             "ON CONFLICT(login) DO UPDATE SET language=%s",
             (LOGIN, 'pl', 'pl'))
        assert c.get('/xhr/prefs').get_json()['language'] is None


def test_prefs_post_omitting_language_preserves_stored(app):
    # #4: a client that never loaded prefs omits `language` (stale tab / failed
    # GET). The stored language + cookie must be left untouched, not wiped.
    with app.test_client() as c:
        _login(c)
        c.post('/xhr/prefs', json=_payload('de'))
        assert _pref_lang(LOGIN) == 'de'
        no_lang = {k: v for k, v in _payload(None).items() if k != 'language'}
        resp = c.post('/xhr/prefs', json=no_lang)
        assert resp.status_code == 200
        assert resp.get_json()['language'] == 'de'   # preserved, not wiped
        assert _pref_lang(LOGIN) == 'de'             # DB unchanged
        assert 'Set-Cookie' not in resp.headers      # cookie untouched


def test_prefs_post_null_persists_and_deletes_cookie(app):
    with app.test_client() as c:
        _login(c)
        c.post('/xhr/prefs', json=_payload('de'))
        assert c.get('/xhr/prefs').get_json()['language'] == 'de'
        resp = c.post('/xhr/prefs', json=_payload(None))
        assert resp.status_code == 200
        assert resp.get_json()['language'] is None
        assert 'Max-Age=0' in resp.headers.get('Set-Cookie', '')
        assert _pref_lang(LOGIN) is None


def test_prefs_post_empty_string_rejected_by_schema(app):
    with app.test_client() as c:
        _login(c)
        assert c.post('/xhr/prefs', json=_payload('')).status_code == 400


def test_prefs_post_code_outside_languages_rejected(app):
    with app.test_client() as c:
        _login(c)
        # 'pl' has a locale file but is not in WARP_LANGUAGES=["en","de","fr"]
        assert c.post('/xhr/prefs', json=_payload('pl')).status_code == 400


def test_prefs_post_valid_code_persists_and_sets_cookie(app):
    with app.test_client() as c:
        _login(c)
        resp = c.post('/xhr/prefs', json=_payload('fr'))
        assert resp.status_code == 200
        assert resp.get_json()['language'] == 'fr'
        assert 'warp_lang=fr' in resp.headers.get('Set-Cookie', '')
        assert _pref_lang(LOGIN) == 'fr'


def test_bootstrap_upserts_cookie_into_prefs_for_new_user(app):
    # The no-op-UPDATE bug (round 2, #4): a user with NO prefs row must get one
    # created, not a zero-row UPDATE.
    with app.test_client() as c:
        _login(c)
        assert _pref_lang(LOGIN) is None  # no row at all
        c.set_cookie('warp_lang', 'de')
        assert c.get('/xhr/bootstrap').status_code == 200
        assert _pref_lang(LOGIN) == 'de'


def test_bootstrap_prefs_win_reset_stale_cookie(app):
    # Shared device: prefs set, cookie stale -> bootstrap resets cookie to prefs.
    with app.test_client() as c:
        _login(c)
        c.post('/xhr/prefs', json=_payload('de'))       # prefs.language = de
        c.set_cookie('warp_lang', 'fr')                 # stale cookie
        resp = c.get('/xhr/bootstrap')
        assert 'warp_lang=de' in resp.headers.get('Set-Cookie', '')


def test_bootstrap_invalid_cookie_deleted(app):
    with app.test_client() as c:
        _login(c)
        c.set_cookie('warp_lang', 'pl')  # not in LANGUAGES, no prefs row
        resp = c.get('/xhr/bootstrap')
        assert 'Max-Age=0' in resp.headers.get('Set-Cookie', '')
        assert _pref_lang(LOGIN) is None  # nothing persisted


def test_bootstrap_stored_pref_removed_from_languages_treated_as_none(app):
    # A stored code the deployment later removed must not be echoed into the
    # cookie/active; a stale cookie is still cleaned up, and the render path
    # agrees (spa page paints the default).
    with app.test_client() as c:
        _login(c)
        _sql("INSERT INTO user_prefs(login, language) VALUES(%s,%s) "
             "ON CONFLICT(login) DO UPDATE SET language=%s",
             (LOGIN, 'pl', 'pl'))
        c.set_cookie('warp_lang', 'pl')
        resp = c.get('/xhr/bootstrap')
        assert 'Max-Age=0' in resp.headers.get('Set-Cookie', '')
        html = c.get('/').get_data(as_text=True)
        assert 'lang="en"' in html