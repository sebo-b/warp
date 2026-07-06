import flask
from warp.config import *

class _BasePathMiddleware:
    """Mounts the app under BASE_PATH by setting SCRIPT_NAME on every request.
    Flask's url_for (routes, static, xhr, the PWA manifest scope/start_url)
    rebases off SCRIPT_NAME automatically, so this one middleware makes the
    whole app prefix-aware. The reverse proxy must forward the full path
    (prefix included); the prefix is stripped here, not at the proxy.

    A request outside the prefix is answered 404 right here — deliberately
    loud. The quiet alternatives are both misconfiguration traps: passing it
    through unstripped would serve the whole app at unprefixed URLs too
    (a duplicate origin), and stamping SCRIPT_NAME without stripping would
    render pages whose every url_for link is wrong."""

    def __init__(self, wsgi_app, basePath):
        self.wsgi_app = wsgi_app
        self.basePath = basePath

    def __call__(self, environ, start_response):
        pathInfo = environ.get('PATH_INFO', '')
        # The prefix is a path segment, not a string prefix: /warp and
        # /warp/... match, /warpstuff must not.
        if pathInfo == self.basePath:
            environ['PATH_INFO'] = '/'
        elif pathInfo.startswith(self.basePath + '/'):
            environ['PATH_INFO'] = pathInfo[len(self.basePath):]
        else:
            start_response('404 NOT FOUND', [('Content-Type', 'text/plain')])
            return [b'404: outside of WARP_BASE_PATH\n']
        environ['SCRIPT_NAME'] = self.basePath
        return self.wsgi_app(environ, start_response)

def create_app():

    app = flask.Flask(__name__)

    initConfig(app)

    if app.config['BASE_PATH']:
        app.wsgi_app = _BasePathMiddleware(app.wsgi_app, app.config['BASE_PATH'])

    from . import i18n
    i18n.init_app(app)

    # Per-render language context for base.html (the <html lang> attribute,
    # the resolved i18nUrl, and the login dropdown menu). App-level, not
    # blueprint-scoped, so it runs under every blueprint (auth/view) and the
    # themed error pages below. resolve_language_for_request reads
    # user_prefs on every logged-in render (decision 3) — wrapped so a DB
    # hiccup during an error render can't turn a 404 into a 500.
    @app.context_processor
    def _language_context():
        try:
            active, menu = i18n.resolve_language_for_request()
            aria = i18n.lang_aria_for(active)
            flag = app.extensions['warp_i18n'][active]['flag']
        except Exception:
            active = app.config['DEFAULT_LANGUAGE']
            menu = []
            aria = active
            flag = ''
        return {
            'resolved_lang': active,
            'languages': menu,
            'active_flag': flag,
            'lang_aria': aria,
        }

    from . import db
    db.init(app)

    from . import ical
    app.register_blueprint(ical.bp)

    from . import view
    app.register_blueprint(view.bp)

    from . import xhr
    app.register_blueprint(xhr.bp, url_prefix='/xhr')

    from . import auth
    from . import auth_mellon
    from . import auth_ldap
    from . import auth_aad
    from . import auth_oidc
    from . import auth_saml
    if 'AUTH_MELLON' in app.config \
       and 'MELLON_ENDPOINT' in app.config \
       and app.config['AUTH_MELLON']:
        app.register_blueprint(auth_mellon.bp)
    elif 'AUTH_LDAP' in app.config \
       and app.config['AUTH_LDAP']:
        app.register_blueprint(auth_ldap.bp)
    elif 'AUTH_AAD' in app.config \
       and app.config['AUTH_AAD']:
        app.register_blueprint(auth_aad.bp)
    elif app.config.get('AUTH_OIDC'):
        app.register_blueprint(auth_oidc.bp)
    elif app.config.get('AUTH_SAML'):
        app.register_blueprint(auth_saml.bp)
    else:
        app.register_blueprint(auth.bp)

    if app.debug:
        from . import debug as debug_mod
        app.register_blueprint(debug_mod.bp)

    # Themed server-level error pages (404/403/500): without these Flask serves
    # its bare default HTML — no top bar, no theme, no bundle. Render a simple
    # themed card (base.html + public bundle + public_nav.html) so an unknown
    # path or an unhandled abort lands on a page that matches the rest of the
    # app. Status is preserved from the abort; bodies are not asserted by e2e
    # (only resp.status()), so the SPA's /xhr 403/404 aborts are unaffected.
    # Titles mirror the SPA's own #view-error strings (app/router.js) so the
    # client and server error views read the same.
    @app.errorhandler(403)
    def _forbidden(e):
        return flask.render_template(
            'error.html', title='You do not have access to this page.'), 403

    @app.errorhandler(404)
    def _not_found(e):
        return flask.render_template('error.html', title='Page not found.'), 404

    # The 500 handler replaces Flask's interactive Werkzeug debugger, which we
    # want to KEEP in debug mode (so a dev traceback isn't hidden behind a
    # pretty page). Register it only outside debug.
    if not app.debug:
        @app.errorhandler(500)
        def _server_error(e):
            return flask.render_template('error.html', title='Something went wrong.'), 500

    return app
