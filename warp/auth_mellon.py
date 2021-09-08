import flask
from .db import *
from warp.auth import ROLE_USER, ROLE_BLOCKED, session
from . import utils

bp = flask.Blueprint('auth', __name__)

@bp.route('/login')
def login():

    # force SAML request
    if flask.session.get('uid'):

        flask.session.clear()
        
        mellonEndpoint = flask.current_app.config['MELLON_ENDPOINT']
        endpoint = f"{mellonEndpoint}/login?ReturnTo={flask.url_for('auth.login')}"
        
        return flask.redirect(endpoint)

    login = flask.request.environ['MELLON_uid']
    userName = bytes(flask.request.environ['MELLON_cn'],'ISO-8859-1').decode('utf-8')

    c = Users.select(Users.id, Users.role, Users.name).where(Users.login == login)

    if len(c) == 1:

        if c[0]['role'] >= ROLE_BLOCKED:
            flask.abort(403)

        flask.session['uid'] = c[0]['id']
        flask.session['role'] = c[0]['role']

        if c[0]['name'] != userName:
            with DB.atomic():
                Users.update({Users.name: userName}).where(Users.login == login).execute()

    else:

        with DB.atomic():
            lastrowid = Users.insert({ 
                    Users.login: login,
                    Users.name: userName,
                    Users.role: ROLE_USER,
                    Users.password: '*'
                }).execute()

        flask.session['uid'] = lastrowid
        flask.session['role'] = ROLE_USER

    flask.session['login_time'] = utils.now()

    return flask.redirect(flask.url_for('view.index'))

@bp.route('/logout')
def logout():

    flask.session.clear()
    
    mellonEndpoint = flask.current_app.config['MELLON_ENDPOINT']
    endpoint = f"{mellonEndpoint}/logout?ReturnTo={flask.url_for('auth.login')}"
    
    return flask.redirect(endpoint)


bp.before_app_request(session)