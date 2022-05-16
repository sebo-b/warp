from functools import partial
from time import sleep
import sys

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
Zone = Table('zone',('id','zone_group','name','iid'))
ZoneAssign = Table('zone_assign',('zid','login','zone_role'))
Book = Table('book',('id','login','sid','fromts','tots'))
SeatAssign = Table('seat_assign',('sid','login'))

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

__all__ = ["DB", "Blobs", "Users", "Groups","Seat", "Zone", "ZoneAssign", "Book","SeatAssign","UserToZoneRoles",
           "IntegrityError", "COUNT_STAR", "SQL_ONE",
           'ACCOUNT_TYPE_ADMIN','ACCOUNT_TYPE_USER','ACCOUNT_TYPE_BLOCKED','ACCOUNT_TYPE_GROUP',
           'ZONE_ROLE_ADMIN', 'ZONE_ROLE_USER', 'ZONE_ROLE_VIEWER']

_INITIALIZED_TABLE = 'db_initialized'

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

                if not force:

                    try:
                        DB.execute_sql(f"CREATE TABLE {_INITIALIZED_TABLE}();")
                    except DatabaseError:
                        # database already initialized
                        return

                print(f'Initializing DB force={force}')

                for file in initScripts:

                    print(f'Executing SQL: {file}')

                    with current_app.open_resource(file) as f:
                        sql = f.read().decode('utf8')
                        DB.execute(SQL(sql))

                # in case it is cleaned up in the above scripts (or force == True)
                DB.execute_sql(f"CREATE TABLE IF NOT EXISTS {_INITIALIZED_TABLE}();")

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
