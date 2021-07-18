import flask
from werkzeug.security import check_password_hash, generate_password_hash
from warp.db import getDB

ROLE_ADMIN = 0
ROLE_USER = 1
ROLE_VIEVER = 2

bp = flask.Blueprint('auth', __name__)

@bp.route('/login', methods=['GET', 'POST'])
def login():

    error = None
    
    if flask.request.method == 'POST':

        u = flask.request.form['username']
        p =  flask.request.form['password']

        #print(generate_password_hash(p))

        userRow = getDB().cursor().execute("SELECT * FROM user WHERE username = ?",(u,)).fetchone()

        if userRow is not None and check_password_hash(userRow['password'],p):
            flask.session['username'] = u
            flask.session['uid'] = userRow['id']
            flask.session['role'] = userRow['role']
            return flask.redirect(flask.url_for('main.index'))

        error = "Wrong username or password"
        flask.session.pop('username', None)
    
    if flask.session.get('username') is not None:
        return flask.redirect(flask.url_for('main.index'))
    
    return flask.render_template('login.html', error=error)

@bp.route('/logout')
def logout():
    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))
