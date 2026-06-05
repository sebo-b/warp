from functools import partial
from time import sleep
import sys
import os
import re

from peewee import Table, SQL, fn, IntegrityError, DatabaseError, OperationalError
import playhouse.db_url
import click
from flask.cli import with_appcontext
from flask import current_app

DB = None

Blobs = Table('blobs',('id','mimetype','data','etag'),primary_key='id')
Users = Table('users',('login','password','name','account_type'))
Groups = Table('groups',('group','login'))
Seat = Table('seat',('id','zid','name','x','y','enabled'))
Zone = Table('zone',('id','zone_group','name','iid','zone_type'))
ZoneAssign = Table('zone_assign',('zid','login','zone_role'))
Book = Table('book',('id','login','sid','fromts','tots'))
SeatAssign = Table('seat_assign',('sid','login','days_in_advance'))

UserPrefs = Table('user_prefs',('login','default_zone','default_day','default_time_from','default_time_to','ical_enabled','ical_token'), primary_key='login')

UserToZoneRoles = Table('user_to_zone_roles',('login','zid','zone_role'))

COUNT_STAR = fn.COUNT(SQL('*'))
SQL_ONE = SQL('1')

# the highest role must be the lowest value
ACCOUNT_TYPE_ADMIN = 10
ACCOUNT_TYPE_USER = 20
ACCOUNT_TYPE_BLOCKED = 90
ACCOUNT_TYPE_GROUP = 100

# the highest role must be the lowest value
ZONE_ROLE_ADMIN = 10
ZONE_ROLE_USER = 20
ZONE_ROLE_VIEWER = 30

ZONE_TYPE_DISABLED    = 10
ZONE_TYPE_ENABLED     = 20
ZONE_TYPE_PUBLIC_VIEW = 30
ZONE_TYPE_PUBLIC_BOOK = 40

# Reserved sentinel login used as the in-memory key for the "everyone" (NULL-login)
# seat assignment row on the frontend. Must never exist as a real user login —
# rejected by users.edit. Mirror this value in js/views/modules/seat.js EVERYONE_KEY.
EVERYONE_KEY = '__everyone__:550e8400-e29b-41d4-a716-446655440000'

def effectiveZoneRole(zone_type, specificRole):
    """Compute effective zone role from zone_type and the user's specific role.

    Returns the role (lowest number = most permissive), or None if no access.
    DISABLED zones only grant access to ZONE_ROLE_ADMIN.
    """
    if zone_type == ZONE_TYPE_DISABLED:
        return specificRole if specificRole == ZONE_ROLE_ADMIN else None

    if zone_type == ZONE_TYPE_PUBLIC_BOOK:
        everyoneRole = ZONE_ROLE_USER
    elif zone_type == ZONE_TYPE_PUBLIC_VIEW:
        everyoneRole = ZONE_ROLE_VIEWER
    else:
        everyoneRole = None

    candidates = [r for r in (specificRole, everyoneRole) if r is not None]
    return min(candidates) if candidates else None

__all__ = ["DB", "Blobs", "Users", "Groups","Seat", "Zone", "ZoneAssign", "Book","SeatAssign", "UserPrefs", "UserToZoneRoles",
           "IntegrityError", "COUNT_STAR", "SQL_ONE",
           'ACCOUNT_TYPE_ADMIN','ACCOUNT_TYPE_USER','ACCOUNT_TYPE_BLOCKED','ACCOUNT_TYPE_GROUP',
           'ZONE_ROLE_ADMIN', 'ZONE_ROLE_USER', 'ZONE_ROLE_VIEWER',
           'ZONE_TYPE_DISABLED', 'ZONE_TYPE_ENABLED', 'ZONE_TYPE_PUBLIC_VIEW', 'ZONE_TYPE_PUBLIC_BOOK',
           'EVERYONE_KEY', 'effectiveZoneRole']

_ADVISORY_LOCK_KEY = 7484381

def _connect():
    DB.connect()

def _disconnect(ctx):
    DB.close()

def init(app):

    global DB

    connStr = app.config['DATABASE']
    connArgs = app.config['DATABASE_ARGS'] if 'DATABASE_ARGS' in app.config else {}

    DB = playhouse.db_url.connect(connStr, autoconnect=False, thread_safe=True, **connArgs)

    Blobs.bind(DB)
    Users.bind(DB)
    Groups.bind(DB)
    Seat.bind(DB)
    Zone.bind(DB)
    ZoneAssign.bind(DB)
    Book.bind(DB)
    SeatAssign.bind(DB)
    UserPrefs.bind(DB)
    UserToZoneRoles.bind(DB)

    app.before_request(_connect)
    app.teardown_request(_disconnect)

    if 'DATABASE_INIT_SCRIPT' in app.config:

        commandParams = {"help": "Create and initialize database.", 'callback': with_appcontext(partial(initDB,True)) }
        cmd = click.Command('init-db', **commandParams)
        app.cli.add_command(cmd)

    if '--help' not in sys.argv[1:] and 'init-db' not in sys.argv[1:]:
        with app.app_context():
            initDB()

def _runMigrations(initScripts):

    sql_dir = os.path.dirname(initScripts[0])
    full_sql_dir = os.path.join(current_app.root_path, sql_dir)

    migrations = []
    try:
        for filename in os.listdir(full_sql_dir):
            if filename.endswith('.sql') and 'migration' in filename.lower():
                migrations.append(os.path.join(sql_dir, filename))
    except OSError:
        pass

    migrations.sort()

    for script in migrations:
        print(f'Executing migration script: {script}')
        with current_app.open_resource(script) as f:
            DB.execute(SQL(f.read().decode('utf8')))

def initDB(force = False):

    initScripts = current_app.config.get('DATABASE_INIT_SCRIPT')

    if not initScripts:
        print("DATABASE_INIT_SCRIPT not defined ")
        return

    if isinstance(initScripts,str):
        initScripts = [ initScripts ]

    retries = current_app.config['DATABASE_INIT_RETRIES']
    retDelay = current_app.config['DATABASE_INIT_RETRIES_DELAY']

    if retries < 1:
        retries = 1

    while True:

        try:

            with DB:

                DB.execute_sql(f"SELECT pg_advisory_xact_lock({_ADVISORY_LOCK_KEY})")

                table_exists = False
                if not force:
                    table_exists = DB.execute_sql(
                        "SELECT EXISTS(SELECT FROM information_schema.tables"
                        " WHERE table_name = 'db_initialized' AND table_schema = current_schema())"
                    ).fetchone()[0]

                if table_exists:
                    DB.execute_sql("ALTER TABLE db_initialized ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0")
                    current_version_row = DB.execute_sql("SELECT version FROM db_initialized LIMIT 1").fetchone()
                    current_version = current_version_row[0] if current_version_row else 0

                    schema_version = 0
                    for file in initScripts:
                        with current_app.open_resource(file) as f:
                            file_content = f.read().decode('utf8')
                            match = re.search(r'schema_version\s.*:=\s*(\d+)', file_content, re.IGNORECASE)
                            if match:
                                schema_version = max(schema_version, int(match.group(1)))

                    if current_version < schema_version:
                        _runMigrations(initScripts)

                    break

                print(f'Initializing DB force={force}')

                for file in initScripts:

                    print(f'Executing SQL: {file}')

                    with current_app.open_resource(file) as f:
                        sql = f.read().decode('utf8')
                        DB.execute(SQL(sql))

            print('The database initialized.')
            break

        except OperationalError:

            retries -= 1
            if retries == 0:
                print(f"ERROR: Cannot connect to the database.", file=sys.stderr, flush=True)
                raise

            print(f"Database connection error, waiting {retDelay} second(s).", file=sys.stderr, flush=True)
            sleep(retDelay)
            print(f'Retrying ({retries}).', file=sys.stderr, flush=True)
