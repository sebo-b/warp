import flask
from werkzeug.security import check_password_hash, generate_password_hash
from warp.db import getDB

ROLE_ADMIN = 0
ROLE_MANAGER = 1
ROLE_USER = 2
ROLE_VIEVER = 3

bp = flask.Blueprint('auth', __name__)

@bp.route('/login', methods=['GET', 'POST'])
def login():

    if flask.request.method == 'POST':

        u = flask.request.form.get('login')
        p =  flask.request.form.get('password')

        #print(generate_password_hash(p))

        userRow = getDB().cursor().execute("SELECT * FROM user WHERE login = ?",(u,)).fetchone()

        if userRow is not None:
            
            passHash = userRow['password']

            if passHash and check_password_hash(passHash,p):
                flask.session['uid'] = userRow['id']
                flask.session['role'] = userRow['role']
                return flask.redirect(flask.url_for('view.index'))

        flask.flash("Wrong username or password")
        flask.session.pop('uid', None)
    
    if flask.session.get('uid') is not None:
        return flask.redirect(flask.url_for('view.index'))
    
    return flask.render_template('login.html')

@bp.route('/logout')
def logout():
    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))
