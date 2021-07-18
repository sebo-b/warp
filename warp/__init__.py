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


#def getDB():
#
#    db = getattr(g, 'database', None)
#    if db is None:
#        db_file = os.path.join(app.root_path, app.config['DATABASE'])
#        db = g.database = sqlite3.connect(db_file)
#        db.row_factory = sqlite3.Row
#
#    return db
#
#@app.teardown_appcontext
#def closeDBConnection(error):
#    db = getattr(g, 'database', None)
#    if db is not None:
#        db.close()

#import warp.views
#import warp.login
