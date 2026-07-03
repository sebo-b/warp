# Tests for the PWA plumbing and the BASE_PATH mount-prefix machinery:
# - WARP_BASE_PATH env normalization (warp/config.py)
# - _BasePathMiddleware SCRIPT_NAME/PATH_INFO handling incl. the loud 404
#   for requests outside the prefix (warp/__init__.py)
# - /manifest.webmanifest and /sw.js routes: content, headers, and the
#   auth-session bypass (the browser fetches the manifest without cookies,
#   so both must work with NO session — that bypass is the point)
#
# Run with:  python -m pytest tests/  (from the repo root)

import pytest

import warp


@pytest.fixture
def make_app(monkeypatch):
    """create_app with DevelopmentSettings and an optional WARP_BASE_PATH."""
    def make(base_path=None):
        monkeypatch.setenv('FLASK_DEBUG', '1')
        if base_path is None:
            monkeypatch.delenv('WARP_BASE_PATH', raising=False)
        else:
            monkeypatch.setenv('WARP_BASE_PATH', base_path)
        return warp.create_app()
    return make


# ---------------------------------------------------------------------------
# BASE_PATH normalization
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('raw', ['warp', '/warp', '/warp/', 'warp/'])
def test_base_path_normalized(make_app, raw):
    assert make_app(raw).config['BASE_PATH'] == '/warp'


@pytest.mark.parametrize('raw', [None, '', '/'])
def test_base_path_empty_means_root(make_app, raw):
    assert make_app(raw).config['BASE_PATH'] == ''


def test_base_path_nested(make_app):
    assert make_app('/tools/warp/').config['BASE_PATH'] == '/tools/warp'


# ---------------------------------------------------------------------------
# _BasePathMiddleware
# ---------------------------------------------------------------------------

def test_prefixed_request_routes_and_rebases_urls(make_app):
    c = make_app('/warp').test_client()
    r = c.get('/warp/manifest.webmanifest')
    assert r.status_code == 200
    m = r.get_json(force=True)
    assert m['scope'] == '/warp/'
    assert m['start_url'] == '/warp/'
    assert all(i['src'].startswith('/warp/static/') for i in m['icons'])


def test_bare_prefix_maps_to_index(make_app):
    # /warp (no trailing slash) is the app root: index → login redirect,
    # rebased under the prefix.
    r = make_app('/warp').test_client().get('/warp')
    assert r.status_code == 302
    assert r.headers['Location'].endswith('/warp/login')


def test_request_outside_prefix_is_404(make_app):
    c = make_app('/warp').test_client()
    # unprefixed path must NOT be served (no quiet duplicate-origin app)
    assert c.get('/manifest.webmanifest').status_code == 404
    assert c.get('/login').status_code == 404
    # the prefix is a path segment, not a string prefix
    assert c.get('/warpstuff').status_code == 404


def test_no_middleware_at_root(make_app):
    c = make_app(None).test_client()
    assert c.get('/manifest.webmanifest').status_code == 200
    r = c.get('/')
    assert r.status_code == 302
    assert r.headers['Location'].endswith('/login')


# ---------------------------------------------------------------------------
# Manifest route
# ---------------------------------------------------------------------------

def test_manifest_content(make_app):
    r = make_app(None).test_client().get('/manifest.webmanifest')
    assert r.status_code == 200
    assert r.mimetype == 'application/manifest+json'
    assert r.headers['Cache-Control'] == 'no-cache'
    m = r.get_json(force=True)
    assert m['display'] == 'standalone'
    assert m['scope'] == '/' and m['start_url'] == '/'
    assert m['background_color'] == m['theme_color'] == '#2C3E50'
    sizes = {(i['sizes'], i['purpose']) for i in m['icons']}
    assert sizes == {('192x192', 'any'), ('512x512', 'any'), ('512x512', 'maskable')}


# ---------------------------------------------------------------------------
# Service-worker route
# ---------------------------------------------------------------------------

def test_sw_content(make_app):
    r = make_app(None).test_client().get('/sw.js')
    assert r.status_code == 200
    assert r.mimetype == 'text/javascript'
    assert r.headers['Cache-Control'] == 'no-cache'
    body = r.get_data(as_text=True)
    # the SW must stay a no-op: no fetch interception, ever, without revisiting
    # the caching decisions documented in the file
    assert "addEventListener('fetch'" not in body


# ---------------------------------------------------------------------------
# Auth-session bypass
# ---------------------------------------------------------------------------

def test_pwa_endpoints_public_but_gate_still_active(make_app):
    c = make_app(None).test_client()  # no session cookie on any request
    assert c.get('/manifest.webmanifest').status_code == 200
    assert c.get('/sw.js').status_code == 200
    # the session gate itself still guards ordinary views
    r = c.get('/')
    assert r.status_code == 302 and r.headers['Location'].endswith('/login')
