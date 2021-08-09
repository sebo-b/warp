import flask

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

    return app
