import json
import os

__all__ = ['initConfig']

class DefaultSettings(object):

    LANGUAGE_FILE="i18n/en.js"

    # after how many days force user to re-login (note that it is not a session timeout)
    SESSION_LIFETIME = 1

    # for how many weeks in advance users can book a seat
    # (after the current week)
    WEEKS_IN_ADVANCE = 1

    MAX_CONTENT_LENGTH = 5 * 1024 * 1024

    # maximum size of uploaded map file
    MAX_MAP_SIZE = 2 * 1024 * 1024

    MAX_REPORT_ROWS = 5000

    DATABASE_INIT_SCRIPT = "sql/schema.sql"

    # number of connection retries to DB on initialization
    DATABASE_INIT_RETRIES = 10
    # delay between retries
    DATABASE_INIT_RETRIES_DELAY = 2

    # LDAP defaults
    LDAP_USER_CLASS = "user"
    WARP_LDAP_USER_ID_ATTRIBUTE = "uid"
    WARP_LDAP_USER_NAME_ATTRIBUTE = "cn"
    LDAP_AUTH_USE_LDAPS = False
    LDAP_AUTH_USE_STARTTLS = False
    LDAP_MATCHING_RULE_IN_CHAIN = False
    LDAP_USER_GROUPS_ATTRIBUTE = "memberOf"
    LDAP_AUTH_TLS_VERSION = "1.2"
    LDAP_AUTH_VALIDATE_CERT = False
    LDAP_AUTH_CIPHER = "ECDHE-RSA-AES256-SHA384"
    LDAP_AUTH_SERVER_PORT = 389
    LDAP_AUTH_TYPE = "SIMPLE"

    # these settings are available, but should not have default value
    # set them up in DevelopmentSettings or via environment
    #
    # SECRET_KEY
    # DATABASE
    # DATABASE_ARGS
    # AUTH_MELLON
    # MELLON_ENDPOINT

class DevelopmentSettings(DefaultSettings):

    DATABASE = "postgresql://postgres:postgres_password@127.0.0.1:5432/postgres"

    #DATABASE = "sqlite:///warp/db.sqlite"
    #DATABASE_ARGS = {"pragmas": {"foreign_keys": "ON"}}

    DATABASE_INIT_SCRIPT = [
        "sql/clean_db.sql",
        "sql/schema.sql",
        "sql/sample_data.sql"
    ]

    SECRET_KEY = b'change_me'

class ProductionSettings(DefaultSettings):

    # use mellon (Apache SAML module) for authentication
    #AUTH_MELLON = False
    #MELLON_ENDPOINT = "/sp"
    #MELLON_DEFAULT_GROUP = "everybody"

    # this is intentionally empty, as in production
    # DATABASE and SECRET_KEY should be passed via ENV
    # as WARP_SECRET_KEY and WARP_DATABASE
    pass

def readEnvironmentSettings(app):

    PREFIX="WARP_"

    res = {}
    for key,val in os.environ.items():
        if key.startswith(PREFIX):
            try:
                val = json.loads(val.lower())       # try to parse any valid json type
            except json.decoder.JSONDecodeError:
                pass                                # fallback to string (no change)
            res[key.removeprefix(PREFIX)] = val

    app.config.update(res)



def initConfig(app):

    if app.env != 'production':
        app.config.from_object(DevelopmentSettings)
    else:
        app.config.from_object(ProductionSettings)

    readEnvironmentSettings(app)

    if app.config.get('SECRET_KEY',None) is None:
        raise Exception('SECRET_KEY must be defined or passed via WARP_SECRET_KEY environment variable')
    if app.config.get('DATABASE',None) is None:
        raise Exception('DATABASE must be defined or passed via WARP_DATABASE environment variable')
