from flask import Flask, g
import os
import sqlite3


def create_app():

    app = Flask(__name__)
    app.config.from_object('warp.config')

    from . import db
    app.teardown_appcontext(db.closeDB)
    app.cli.add_command(db.initDB)

    from . import main
    app.register_blueprint(main.bp)

    from . import auth
    app.register_blueprint(auth.bp)

    return app
