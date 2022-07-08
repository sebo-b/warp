import functools
from . import utils
from warp.db import *

import flask
from warp.auth import ROLE_USER, session

from authlib.integrations.requests_client import OAuth2Session
import google.oauth2.credentials
import googleapiclient.discovery

ACCESS_TOKEN_URI = 'https://www.googleapis.com/oauth2/v4/token'
AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent'

AUTHORIZATION_SCOPE = 'openid email profile'

AUTH_TOKEN_KEY = 'auth_token'
AUTH_STATE_KEY = 'auth_state'

bp = flask.Blueprint('auth', __name__)


def is_logged_in():
    return True if AUTH_TOKEN_KEY in flask.session else False


def build_credentials():
    if not is_logged_in():
        raise Exception('User must be logged in')

    oauth2_tokens = flask.session[AUTH_TOKEN_KEY]

    return google.oauth2.credentials.Credentials(
        oauth2_tokens['access_token'],
        refresh_token=oauth2_tokens['refresh_token'],
        client_id=flask.current_app.config.get('GOOGLE_CLIENT_ID'),
        client_secret=flask.current_app.config.get('GOOGLE_CLIENT_SECRET'),
        token_uri=ACCESS_TOKEN_URI)


def get_user_info():
    credentials = build_credentials()

    oauth2_client = googleapiclient.discovery.build(
        'oauth2', 'v2',
        credentials=credentials)

    return oauth2_client.userinfo().get().execute()


def upsert_user(login, userName):
    # c = Users.select(Users.name).where(Users.login == login).scalar()

    c = Users.select().where(
        Users.login == login)

    if len(c) == 1:

        if c[0]['account_type'] >= ACCOUNT_TYPE_BLOCKED:
            flask.abort(403)

        flask.session['login'] = c[0]['login']
        flask.session['account_type'] = c[0]['account_type']

        if c[0]['name'] != userName:
            with DB.atomic():
                Users.update({Users.name: userName}).where(
                    Users.login == login).execute()

    else:
        from secrets import token_urlsafe
        from werkzeug.security import generate_password_hash

        with DB.atomic():
            lastrowid = Users.insert({
                Users.login: login,
                Users.name: userName,
                Users.account_type: ACCOUNT_TYPE_USER,
                Users.password: generate_password_hash(
                    token_urlsafe(18))
            }).execute()

            defaultGroup = flask.current_app.config.get('GOOGLE_DEFAULT_GROUP')

            if defaultGroup is not None:
                Groups.insert({
                    Groups.group: defaultGroup,
                    Groups.login: login
                }).execute()

        flask.session['uid'] = lastrowid
        flask.session['role'] = ROLE_USER

    flask.session['login_time'] = utils.now()


def no_cache(view):
    @functools.wraps(view)
    def no_cache_impl(*args, **kwargs):
        response = flask.make_response(view(*args, **kwargs))
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '-1'
        return response

    return functools.update_wrapper(no_cache_impl, view)


@bp.route('/login')
@no_cache
def login():
    flask.session.clear()

    session = OAuth2Session(flask.current_app.config.get('GOOGLE_CLIENT_ID'),
                            flask.current_app.config.get(
                                'GOOGLE_CLIENT_SECRET'),
                            scope=AUTHORIZATION_SCOPE,
                            redirect_uri=flask.current_app.config.get('GOOGLE_AUTH_REDIRECT_URI'))

    uri, state = session.create_authorization_url(AUTHORIZATION_URL)

    flask.session[AUTH_STATE_KEY] = state

    return flask.redirect(uri, code=302)


@bp.route('/google/auth')
@no_cache
def google_auth_redirect():
    req_state = flask.request.args.get('state', default=None, type=None)

    if req_state != flask.session[AUTH_STATE_KEY]:
        response = flask.make_response('Invalid state parameter', 401)
        return response

    session = OAuth2Session(flask.current_app.config.get('GOOGLE_CLIENT_ID'), flask.current_app.config.get('GOOGLE_CLIENT_SECRET'),
                            scope=AUTHORIZATION_SCOPE,
                            state=flask.session[AUTH_STATE_KEY],
                            redirect_uri=flask.current_app.config.get('GOOGLE_AUTH_REDIRECT_URI'))

    oauth2_tokens = session.fetch_access_token(
        ACCESS_TOKEN_URI,
        authorization_response=flask.request.url)

    flask.session[AUTH_TOKEN_KEY] = oauth2_tokens

    info = get_user_info()

    login = info['email']
    username = info['name']
    upsert_user(login, username)

    return flask.redirect(flask.url_for('view.index'))


@bp.route('/logout')
@no_cache
def logout():
    flask.session.pop(AUTH_TOKEN_KEY, None)
    flask.session.pop(AUTH_STATE_KEY, None)

    flask.session.clear()
    return flask.redirect(flask.url_for('auth.login'))


bp.before_app_request(session)
