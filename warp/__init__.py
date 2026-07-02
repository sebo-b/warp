import flask
from werkzeug.middleware.proxy_fix import ProxyFix
from warp.config import *

def create_app():

    app = flask.Flask(__name__)

    initConfig(app)

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
