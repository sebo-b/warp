import flask
from werkzeug.security import check_password_hash
from warp.db import *
import warp.auth
from . import utils
import sys
import msal
import uuid

bp = flask.Blueprint('auth', __name__)

def _get_authority(tenant: str) -> str:
    return f'https://login.microsoftonline.com/{tenant}'

def _build_msal_app(auth_config):
    return msal.ConfidentialClientApplication(
        auth_config['CLIENT_ID'],
        authority = _get_authority(auth_config['TENANT']),
        client_credential=auth_config['CLIENT_SECRET'])

def _build_auth_url(auth_config,redirect_uri = None, scopes=None, state=None):
	return _build_msal_app(auth_config).get_authorization_request_url(
		scopes = scopes or ['User.Read'],
		state = state or str(uuid.uuid4()),
		prompt = 'select_account',
		redirect_uri = redirect_uri or flask.url_for("auth.signin_oidc", _external=True, _scheme=auth_config['HTTPS_SCHEME']))

@bp.route("/login")
def login():
	auth_config = {
		'TENANT': flask.current_app.config.get('AAD_TENANT'),
		'CLIENT_ID': flask.current_app.config.get('AAD_CLIENT_ID'),
		'CLIENT_SECRET': flask.current_app.config.get('AAD_CLIENT_SECRET'),
		'HTTPS_SCHEME': flask.current_app.config.get('AAD_HTTPS_SCHEME'),
	}

	redirect_uri = flask.url_for('.signin_oidc', _external=True, _scheme=auth_config['HTTPS_SCHEME'])
	flask.session["state"] = str(uuid.uuid4())
	auth_url = _build_auth_url(
		auth_config=auth_config,
		redirect_uri=redirect_uri,
		state=flask.session["state"])
	resp = flask.Response(status=307)
	resp.headers['location'] = auth_url
	return resp

@bp.route("/signin-oidc")
def signin_oidc():
	auth_config = {
		'TENANT': flask.current_app.config.get('AAD_TENANT'),
		'CLIENT_ID': flask.current_app.config.get('AAD_CLIENT_ID'),
		'CLIENT_SECRET': flask.current_app.config.get('AAD_CLIENT_SECRET'),
		'HTTPS_SCHEME': flask.current_app.config.get('AAD_HTTPS_SCHEME') or 'https',
	}

	app_root_uri =  flask.url_for('view.index')

	if flask.request.args.get('state') != flask.session.get("state"):
		raise ValueError("State does not match")
	if "error" in flask.request.args:  # Authentication/Authorization failure
		return flask.render_template("auth_error.html", result=flask.request.args, application_root_uri=app_root_uri)

	redirect_uri = flask.url_for('.signin_oidc', _external=True, _scheme=auth_config['HTTPS_SCHEME'])

	if flask.request.args.get('code'):
		result = _build_msal_app(auth_config).acquire_token_by_authorization_code(
			flask.request.args['code'],
			scopes=["User.Read"],
			redirect_uri=redirect_uri)

		if "error" in result:
			return flask.render_template("auth_error.html", result=result, application_root_uri=app_root_uri)

		userData = aadGetUserMetadata(result.get("id_token_claims"))
		aadApplyUserMetadata(userData)
		flask.session['login'] = userData['login']
		flask.session['login_time'] = utils.now()

	return flask.redirect(app_root_uri)

def aadGetUserMetadata(userData):
	ret = {
		'login': userData[flask.current_app.config.get('AAD_LOGIN_ATTRIBUTE')],
		'userName': userData[flask.current_app.config.get('AAD_USER_NAME_ATTRIBUTE')],
		'groups': [],
	}


	aadGroupMap = flask.current_app.config.get('AAD_GROUP_MAP')
	print(aadGroupMap)

	for aadGroup,warpGroup in aadGroupMap:
		if aadGroup is None or (warpGroup and aadGroup in userData['groups']):
			ret["groups"].append(warpGroup)

	return ret

def aadApplyUserMetadata(userData):
	with DB.atomic():
		c = Users.select(Users.name).where(Users.login == userData['login']).scalar()
		if c is None:
			Users.insert({
				Users.login: userData['login'],
				Users.name: userData["userName"],
				Users.account_type: ACCOUNT_TYPE_USER,
				Users.password: '*'
			}).execute()
		elif c != userData["userName"]:
			Users.update({Users.name: userData["userName"]}).where(Users.login == userData['login']).execute()

		existingGroups = Users.select( Users.login ) \
			.where( Users.account_type == ACCOUNT_TYPE_GROUP ) \
			.where( Users.login.in_(userData["groups"]) ) \
			.tuples()
		existingGroups = [i[0] for i in existingGroups]

		if len(existingGroups) != len(userData["groups"]):
			print("AAD WARNING: some of the groups defined in AAD and mapped via AAD_GROUP_MAP doesn't exist in Warp")

		insertData = [ {Groups.login: userData['login'], Groups.group: i} for i in existingGroups ]
		Groups.insert(insertData).on_conflict_ignore().execute()

		strictMapping = flask.current_app.config.get('AAD_GROUP_STRICT_MAPPING')
		if strictMapping:
			Groups.delete() \
				.where( Groups.login == login ) \
				.where( Groups.group.not_in(existingGroups) ) \
				.execute()

bp.route('/logout')(warp.auth.logout)
bp.before_app_request(warp.auth.session)
