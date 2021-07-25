import flask
import os
from .db import getDB

def session():

    if flask.request.blueprint == 'auth':
        return

    if flask.request.endpoint == 'static' and 'zone_maps' not in flask.request.view_args['filename']:
        return

    if flask.session.get('uid') is None:
        return flask.redirect(
            flask.url_for('auth.login'))


def create_app():

    app = flask.Flask(__name__)
    app.config.from_object('warp.config')

    from . import db
    app.teardown_appcontext(db.closeDB)
    app.cli.add_command(db.initDB)

    from . import view
    app.register_blueprint(view.bp)

    from . import xhr
    app.register_blueprint(xhr.bp)

    from . import auth
    app.register_blueprint(auth.bp)

    app.before_request(session)

    return app
