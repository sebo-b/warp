from peewee import SqliteDatabase, Table, SQL, fn, IntegrityError
import playhouse.db_url
import click
from flask.cli import with_appcontext

DB = None

Users = Table('users',('login','password','name','account_type'))
Groups = Table('groups',('group','login'))
Seat = Table('seat',('id','zid','name','x','y','enabled'))
Zone = Table('zone',('id','zone_group','name','image'))
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

__all__ = ["DB", "Users", "Groups","Seat", "Zone", "ZoneAssign", "Book","SeatAssign","UserToZoneRoles",
           "IntegrityError", "COUNT_STAR", "SQL_ONE",
           'ACCOUNT_TYPE_ADMIN','ACCOUNT_TYPE_USER','ACCOUNT_TYPE_BLOCKED','ACCOUNT_TYPE_GROUP',
           'ZONE_ROLE_ADMIN', 'ZONE_ROLE_USER', 'ZONE_ROLE_VIEWER']

def _connect():
    DB.connect()

def _disconnect(ctx):
    DB.close()

def init(app):

    global DB

    connStr = app.config['DATABASE']
    connArgs = app.config['DATABASE_ARGS'] if 'DATABASE_ARGS' in app.config else {}

    DB = playhouse.db_url.connect(connStr, autoconnect=False, thread_safe=True, **connArgs)

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

        commandParams = {"help": "Create and initialize database.", 'callback': with_appcontext(initDB) }

        if 'DATABASE_SAMPLEDATA_SCRIPT' in app.config:
            commandParams['params'] = [ click.Option(('-s','--sample-data','sample_data'), is_flag = True, default = False, help = "Populate database with a sample data.") ]

        cmd = click.Command('init-db', **commandParams)
        app.cli.add_command(cmd)

def initDB(sample_data = False):

    from flask import current_app

    schemaPath = current_app.config['DATABASE_INIT_SCRIPT']

    with current_app.open_resource(schemaPath) as f, DB:
        sql = f.read().decode('utf8')

        # for sqlite we need to use non-standard executescript
        if isinstance(DB,SqliteDatabase):
            DB.cursor().executescript(sql)
        else:
            DB.execute(SQL(sql))

    click.echo('The database initialized.')

    if sample_data:
        sampleDataPath = current_app.config['DATABASE_SAMPLEDATA_SCRIPT']
        with DB, current_app.open_resource(sampleDataPath) as f:
            sql = f.read().decode('utf8')
            # for sqlite we need to use non-standard executescript
            if isinstance(DB,SqliteDatabase):
                DB.cursor().executescript(sql)
            else:
                DB.execute(SQL(sql))

        click.echo('Sample data inserted.')
