import flask
import json
import os

__all__ = ['initConfig']

class DefaultSettings(object):

    LANGUAGE_FILE="i18n/pl.js"

    # after how many days force user to re-login (note that it is not a session timeout)
    SESSION_LIFETIME = 1

    # for how many weeks in advance users can book a seat
    # (after the current week)
    WEEKS_IN_ADVANCE = 1

    # these settings are available, but should not have default value
    # set them up in DevelopmentSettings or via environment
    #
    # SECRET_KEY
    # DATABASE
    # DATABASE_ARGS
    # DATABASE_INIT_SCRIPT
    # DATABASE_SAMPLEDATA_SCRIPT
    # AUTH_MELLON
    # MELLON_ENDPOINT

class DevelopmentSettings(DefaultSettings):

    DATABASE = "postgresql://warp:warp@localhost:5432/warp"

    #DATABASE = "sqlite:///warp/db.sqlite"
    #DATABASE_ARGS = {"pragmas": {"foreign_keys": "ON"}}

    DATABASE_INIT_SCRIPT = "sql/schema.sql"
    DATABASE_SAMPLEDATA_SCRIPT = "sql/sample_data.sql"

    #DATABASE_INIT_SCRIPT = "sql/schema_sqlite.sql"
    #DATABASE_SAMPLEDATA_SCRIPT = "sql/sample_data_sqlite.sql"

    SECRET_KEY = b'change_me'

class ProductionSettings(DefaultSettings):

    # use mellon (Apache SAML module) for authentication
    #AUTH_MELLON = False
    #MELLON_ENDPOINT = "/sp"

    # this is intentionally empty, as in production
    # DATABASE and SECRET_KEY should be passed via ENV
    # as WARP_SECRET_KEY and WARP_DATABASE
    pass

def readEnvironmentSettings():

    PREFIX="WARP_"

    res = {}
    for key,val in os.environ.items():
        if key.startswith(PREFIX):
            if val.startswith(('{','[')):
                val = json.loads(val)
            res[key.removeprefix(PREFIX)] = val

    return res


def initConfig(app):

    if app.env != 'production':
        app.config.from_object(DevelopmentSettings)
    else:
        app.config.from_object(ProductionSettings)

    app.config.update(readEnvironmentSettings())

    if app.config.get('SECRET_KEY',None) is None:
        raise Exception('SECRET_KEY must be defined or passed via WARP_SECRET_KEY environment variable')
    if app.config.get('DATABASE',None) is None:
        raise Exception('DATABASE must be defined or passed via WARP_DATABASE environment variable')
