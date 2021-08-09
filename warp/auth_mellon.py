import flask
from warp.db import getDB
from warp.auth import ROLE_ADMIN, ROLE_MANAGER, ROLE_USER, ROLE_VIEVER

bp = flask.Blueprint('auth', __name__)

@bp.route('/login')
def login():

    db = getDB()
    cursor = db.cursor()

    u = flask.request.environ['MELLON_uid']

    userRow = cursor.execute("SELECT * FROM user WHERE login = ?",(u,)).fetchone()

    if userRow is not None:

        flask.session['uid'] = userRow['id']
        flask.session['role'] = userRow['role']

    else:

        name = flask.request.environ['MELLON_cn']

        try:

            cursor.execute("INSERT INTO user (login,password,name,role) VALUES (?,?,?,?)",(u,'*',name,ROLE_USER))
            db.commit()

        except:
            db.rollback()
            raise

        flask.session['uid'] = cursor.lastrowid
        flask.session['role'] = ROLE_USER

    return flask.redirect(flask.url_for('view.index'))
