import flask
from .db import *
from warp.auth import session
from . import utils

bp = flask.Blueprint('auth', __name__)

@bp.route('/login')
def login():

    # force SAML request
    if flask.session.get('login'):

        flask.session.clear()

        mellonEndpoint = flask.current_app.config['MELLON_ENDPOINT']
        endpoint = f"{mellonEndpoint}/login?ReturnTo={flask.url_for('auth.login')}"

        return flask.redirect(endpoint)

    login = flask.request.environ.get('MELLON_uid')
    userName = flask.request.environ.get('MELLON_cn')
    #login = flask.request.headers.get('X-MELLON_uid')
    #userName = flask.request.headers.get('X-MELLON_cn')
    if (login is None or userName is None):
        return flask.abort(400)

    userName = bytes(userName,'ISO-8859-1').decode('utf-8')

    c = Users.select(Users.name).where(Users.login == login).scalar()

    if c is None:

        with DB.atomic():

            Users.insert({
                Users.login: login,
                Users.name: userName,
                Users.account_type: ACCOUNT_TYPE_USER,
                Users.password: '*'
            }).execute()

            defaultGroup = flask.current_app.config.get('MELLON_DEFAULT_GROUP')
            if defaultGroup is not None:
                Groups.insert({
                    Groups.group: defaultGroup,
                    Groups.login: login
                }).execute()

    elif c != userName:

        with DB.atomic():
            Users.update({Users.name: userName}).where(Users.login == login).execute()


    flask.session['login'] = login
    flask.session['login_time'] = utils.now()

    return flask.redirect(flask.url_for('view.index'))

@bp.route('/logout')
def logout():

    flask.session.clear()

    mellonEndpoint = flask.current_app.config['MELLON_ENDPOINT']
    endpoint = f"{mellonEndpoint}/logout?ReturnTo={flask.url_for('auth.login')}"

    return flask.redirect(endpoint)


bp.before_app_request(session)
