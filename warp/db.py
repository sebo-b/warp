from peewee import SqliteDatabase, Table, SQL, fn, IntegrityError
import playhouse.db_url
import click
from flask.cli import with_appcontext

DB = None

Users = Table('users',('id','login','password','name','role'))
Seat = Table('seat',('id','zid','name','x','y','enabled'))
Zone = Table('zone',('id','zone_group','name','image'))
Book = Table('book',('id','uid','sid','fromts','tots'))
Assign = Table('assign',('sid','uid'))

COUNT_STAR = fn.COUNT(SQL('*'))

__all__ = ["DB", "Users", "Seat", "Zone", "Book","Assign", "IntegrityError", "COUNT_STAR"]

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
    Seat.bind(DB)
    Zone.bind(DB)
    Book.bind(DB)
    Assign.bind(DB)

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
