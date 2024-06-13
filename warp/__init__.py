import flask
from werkzeug.middleware.proxy_fix import ProxyFix
from warp.config import *

def create_app():

    app = flask.Flask(__name__)

    initConfig(app)

    from . import db
    db.init(app)

    from . import view
    app.register_blueprint(view.bp)

    from . import xhr
    app.register_blueprint(xhr.bp, url_prefix='/xhr')

    from . import auth
    from . import auth_mellon
    from . import auth_ldap
    from . import auth_aad
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
    else:
        app.register_blueprint(auth.bp)

    return app
