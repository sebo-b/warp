import json
import os
import sys

import jsonschema

__all__ = ['initConfig']

class DefaultSettings(object):

    LANGUAGE_FILE="i18n/en.json"

    # after how many days force user to re-login (note that it is not a session timeout)
    SESSION_LIFETIME = 1

    # for how many weeks in advance users can book a seat
    # (after the current week)
    WEEKS_IN_ADVANCE = 1

    AUTOBOOK_USAGE_WINDOW_DAYS = 30

    # Weekdays to hide for reservation, 0 for monday to 6 for sunday
    # Set to [5,6] to omit weekends
    OMITTED_WEEKDAYS = []

    # warp uses server wall-clock (timegm(localtime())) everywhere and is
    # otherwise TZ-blind. This setting only labels iCal DTSTART/DTEND so
    # external calendar clients render the right time. Empty = auto-detect
    # from the system at startup.
    TIMEZONE = ""

    # opening and closing time in seconds from 00:00
    BOOK_OPEN = 0
    BOOK_CLOSE = 24 * 3600

    MAX_CONTENT_LENGTH = 5 * 1024 * 1024

    # maximum size of uploaded map file
    MAX_MAP_SIZE = 2 * 1024 * 1024

    MAX_REPORT_ROWS = 5000

    MIN_PASSWORD_LENGTH = 6

    # Treat logins case-insensitively across every auth backend: a user signs in
    # regardless of letter case and always resolves to a single stored account.
    # Prevents duplicate accounts when the identity provider (e.g. LDAP) is itself
    # case-insensitive. Disable only if your directory has case-sensitive logins.
    LOGIN_IGNORECASE = True

    DATABASE_PRE_INIT_SCRIPTS = []
    DATABASE_POST_INIT_SCRIPTS = []

    # number of connection retries to DB on initialization
    DATABASE_INIT_RETRIES = 10
    # delay between retries
    DATABASE_INIT_RETRIES_DELAY = 2

    # LDAP defaults
    LDAP_AUTH_TYPE = "SIMPLE"
    LDAP_STARTTLS = True
    LDAP_VALIDATE_CERT = False
    LDAP_USER_NAME_ATTRIBUTE = "cn"
    LDAP_USER_SEARCH_FILTER_TEMPLATE = "(objectClass=person)"
    LDAP_GROUP_SEARCH_FILTER_TEMPLATE = "(&(memberUid={login})(cn={group}))"
    LDAP_GROUP_MAP = [ [None,None] ]
    LDAP_GROUP_STRICT_MAPPING = False
    LDAP_EXCLUDED_USERS = []

    # AAD defaults
    AAD_HTTPS_SCHEME = "https"
    AAD_USER_NAME_ATTRIBUTE = "name"
    AAD_LOGIN_ATTRIBUTE = "preferred_username"
    AAD_GROUP_MAP = [ [None,None] ]
    AAD_GROUP_STRICT_MAPPING = False

    ### LDAP variables to be configured
    # AUTH_LDAP = True
    # LDAP_SERVER_URL = "ldap://server:port"
    # LDAP_USER_TEMPLATE = "uid={login},ou=users,dc=example,dc=org"
    # LDAP_USER_SEARCH_BASE
    # LDAP_GROUP_SEARCH_BASE = "ou=groups,dc=example,dc=org"
    # LDAP_TLS_VERSION (optional)
    # LDAP_TLS_CIPHERS (optional)

    # these settings are available, but should not have default value
    # set them up in DevelopmentSettings or via environment
    # SECRET_KEY
    # DATABASE_ADDRESS, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD
    # DATABASE_ARGS

    # mellon settings
    # AUTH_MELLON
    # MELLON_ENDPOINT
    # MELLON_DEFAULT_GROUP

class DevelopmentSettings(DefaultSettings):

    DATABASE_ADDRESS = "127.0.0.1:5432"
    DATABASE_NAME = "postgres"
    DATABASE_USER = "postgres"
    DATABASE_PASSWORD = "postgres_password"

    DATABASE_PRE_INIT_SCRIPTS = [
        "sql/clean_db.sql",
    ]
    DATABASE_POST_INIT_SCRIPTS = [
        "sql/sample_data.sql"
    ]

    SECRET_KEY = b'change_me'


class ProductionSettings(DefaultSettings):

    # use mellon (Apache SAML module) for authentication
    #AUTH_MELLON = False
    #MELLON_ENDPOINT = "/sp"
    #MELLON_DEFAULT_GROUP = "everybody"

    # this is intentionally empty, as in production
    # DATABASE_ADDRESS, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD and SECRET_KEY
    # should be passed via ENV as WARP_DATABASE_ADDRESS, WARP_DATABASE_NAME,
    # WARP_DATABASE_USER, WARP_DATABASE_PASSWORD, and WARP_SECRET_KEY.
    # The password and secret key also support the _FILE convention
    # (e.g. WARP_DATABASE_PASSWORD_FILE=/run/secrets/db_password).
    pass

# --- Environment-variable parsing -------------------------------------------
#
# Each WARP_<NAME> variable maps to exactly one setting with a known type. Its
# value is parsed/validated by the registered formatter; a WARP_ variable with
# no entry is ignored (with a warning), and a value that fails its formatter
# aborts startup with a clear error. The type comes from the setting, not from
# the value — guessing from the value cannot tell a string password "12345"
# from the integer 12345.

def _fmt_str(v):
    return v

def _fmt_int(v):
    return int(v)

def _fmt_bool(v):
    s = v.strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"expected a boolean (true/false/yes/no/on/off/1/0), got {v!r}")

def _fmt_json(schema=None):
    def parse(v):
        value = json.loads(v)
        if schema is not None:
            jsonschema.validate(value, schema)
        return value
    return parse

# Reads the value from a file (for Docker/Podman secrets). Registered under the
# WARP_<KEY>_FILE name; the loop stores the result under the base <KEY>.
def _fmt_file(v):
    try:
        with open(v) as f:
            content = f.read()
    except OSError as e:
        raise ValueError(f"cannot read file {v!r}: {e}") from e
    if content.endswith('\n'):     # strip one trailing newline
        content = content[:-1]
    return content

# JSON shapes for the collection-valued settings.
_ARRAY_OF_STRINGS = {"type": "array", "items": {"type": "string"}}
_ARRAY_OF_WEEKDAYS = {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 6}}
_GROUP_MAP = {  # list of [source_group_or_null, warp_group_or_null] pairs
    "type": "array",
    "items": {"type": "array", "items": {"type": ["string", "null"]}},
}

# The complete set of environment-configurable settings and how to parse them.
# A <KEY>_FILE entry with _fmt_file reads the value from a file and stores it
# under <KEY>; this is restricted to the secrets listed so the _FILE suffix
# cannot shadow real settings (e.g. LANGUAGE_FILE).
_ENV_SETTINGS = {
    # core
    "SECRET_KEY":                 _fmt_str,
    "SECRET_KEY_FILE":            _fmt_file,
    "LANGUAGE_FILE":              _fmt_str,
    "TIMEZONE":                   _fmt_str,
    "SESSION_LIFETIME":           _fmt_int,
    "WEEKS_IN_ADVANCE":           _fmt_int,
    "AUTOBOOK_USAGE_WINDOW_DAYS": _fmt_int,
    "OMITTED_WEEKDAYS":           _fmt_json(_ARRAY_OF_WEEKDAYS),
    "BOOK_OPEN":                  _fmt_int,
    "BOOK_CLOSE":                 _fmt_int,
    "MAX_CONTENT_LENGTH":         _fmt_int,
    "MAX_MAP_SIZE":               _fmt_int,
    "MAX_REPORT_ROWS":            _fmt_int,
    "MIN_PASSWORD_LENGTH":        _fmt_int,
    "LOGIN_IGNORECASE":           _fmt_bool,
    # database
    "DATABASE_ADDRESS":           _fmt_str,
    "DATABASE_NAME":              _fmt_str,
    "DATABASE_USER":              _fmt_str,
    "DATABASE_PASSWORD":          _fmt_str,
    "DATABASE_PASSWORD_FILE":     _fmt_file,
    "DATABASE_ARGS":              _fmt_json({"type": "object"}),
    "DATABASE_PRE_INIT_SCRIPTS":  _fmt_json(_ARRAY_OF_STRINGS),
    "DATABASE_POST_INIT_SCRIPTS": _fmt_json(_ARRAY_OF_STRINGS),
    "DATABASE_INIT_RETRIES":      _fmt_int,
    "DATABASE_INIT_RETRIES_DELAY": _fmt_int,
    # authentication toggles
    "AUTH_LDAP":                  _fmt_bool,
    "AUTH_MELLON":                _fmt_bool,
    "AUTH_AAD":                   _fmt_bool,
    # LDAP
    "LDAP_SERVER_URL":            _fmt_str,
    "LDAP_AUTH_TYPE":             _fmt_str,
    "LDAP_STARTTLS":              _fmt_bool,
    "LDAP_VALIDATE_CERT":         _fmt_bool,
    "LDAP_TLS_VERSION":           _fmt_str,
    "LDAP_TLS_CIPHERS":           _fmt_str,
    "LDAP_USER_TEMPLATE":         _fmt_str,
    "LDAP_USER_NAME_ATTRIBUTE":   _fmt_str,
    "LDAP_USER_SEARCH_BASE":      _fmt_str,
    "LDAP_USER_SEARCH_FILTER_TEMPLATE":  _fmt_str,
    "LDAP_GROUP_SEARCH_BASE":     _fmt_str,
    "LDAP_GROUP_SEARCH_FILTER_TEMPLATE": _fmt_str,
    "LDAP_GROUP_MAP":             _fmt_json(_GROUP_MAP),
    "LDAP_GROUP_STRICT_MAPPING":  _fmt_bool,
    "LDAP_EXCLUDED_USERS":        _fmt_json(_ARRAY_OF_STRINGS),
    # Azure AD
    "AAD_TENANT":                 _fmt_str,
    "AAD_CLIENT_ID":              _fmt_str,
    "AAD_CLIENT_SECRET":          _fmt_str,
    "AAD_HTTPS_SCHEME":           _fmt_str,
    "AAD_USER_NAME_ATTRIBUTE":    _fmt_str,
    "AAD_LOGIN_ATTRIBUTE":        _fmt_str,
    "AAD_GROUP_MAP":              _fmt_json(_GROUP_MAP),
    "AAD_GROUP_STRICT_MAPPING":   _fmt_bool,
    # Mellon (SAML)
    "MELLON_ENDPOINT":            _fmt_str,
    "MELLON_DEFAULT_GROUP":       _fmt_str,
}

def readEnvironmentSettings(app):

    PREFIX = "WARP_"

    res = {}
    for key, val in os.environ.items():
        if not key.startswith(PREFIX):
            continue
        name = key.removeprefix(PREFIX)

        formatter = _ENV_SETTINGS.get(name)
        if formatter is None:
            print(f"WARNING: unknown setting {key}, ignored", file=sys.stderr, flush=True)
            continue
        try:
            value = formatter(val)
        except (ValueError, jsonschema.ValidationError) as e:
            raise Exception(f"Invalid value for {key}: {e}") from e

        # A _FILE entry sources a secret from a file; store it under the base key.
        # Setting both WARP_<KEY> and WARP_<KEY>_FILE is unsupported — the outcome
        # then depends on environment order and is intentionally undefined.
        target = name[:-5] if formatter is _fmt_file else name
        res[target] = value

    app.config.update(res)



def initConfig(app):

    if os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes', 'on'):
        app.config.from_object(DevelopmentSettings)
    else:
        app.config.from_object(ProductionSettings)

    readEnvironmentSettings(app)

    missing = []
    if app.config.get('SECRET_KEY', None) is None:
        missing.append('WARP_SECRET_KEY')
    for key in ('DATABASE_ADDRESS', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'):
        if app.config.get(key, None) is None:
            missing.append(f'WARP_{key}')
    if missing:
        raise Exception(f'Required environment variable(s) not set: {", ".join(missing)}')

    if not app.config.get('TIMEZONE'):
        try:
            with open('/etc/timezone') as f:
                app.config['TIMEZONE'] = f.read().strip()
        except OSError:
            try:
                link = os.readlink('/etc/localtime')
                idx = link.rfind('zoneinfo/')
                if idx != -1:
                    app.config['TIMEZONE'] = link[idx + len('zoneinfo/'):]
            except OSError:
                pass
