from time import sleep
import sys

from peewee import Table, SQL, fn, IntegrityError, DatabaseError, OperationalError
from playhouse.postgres_ext import Psycopg3Database
from flask import current_app

DB = None

Blobs = Table('blobs',('id','mimetype','data','etag'),primary_key='id')
Users = Table('users',('login','password','name','account_type'))
Groups = Table('groups',('group','login'))
Plan = Table('plan',('id','name','iid','dark_filter'))
Seat = Table('seat',('id','pid','zid','name','x','y','enabled'))
Zone = Table('zone',('id','name','zone_type','zone_group'))
ZoneAssign = Table('zone_assign',('zid','login','zone_role'))
Book = Table('book',('id','login','sid','fromts','tots'))
SeatAssign = Table('seat_assign',('sid','login','days_in_advance'))

UserPrefs = Table('user_prefs',('login','default_plan','default_day','default_time_from','default_time_to','ical_enabled','ical_token','reminder_weekdays','reminder_ahead_days','reminder_time','reminder_release_ahead_days','reminder_zones','zone_show_seat_names','zone_show_booking_preview','zone_show_assigned_names'), primary_key='login')

UserToZoneRoles = Table('user_to_zone_roles',('login','zid','zone_role'))

CalendarCache = Table('calendar_cache', ('login', 'type', 'ics', 'day', 'generated_at'))

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

# Reserved sentinel the zone_group header filter sends to select "ungrouped"
# (NULL) zones — Tabulator can't tell an empty value (no filter) from a request
# to match NULL. zones.listW translates it to IS NULL. Must never be a real
# group name. Exposed to the frontend via the template global
# (window.warpGlobals.ungroupedFilterKey); never duplicated as a JS literal.
UNGROUPED_FILTER_KEY = '__ungrouped__:088891f7-4de2-4b08-a8a7-fa2d0d035fa3'

__all__ = ["DB", "Blobs", "Users", "Groups", "Plan", "Seat", "Zone", "ZoneAssign", "Book", "SeatAssign", "UserPrefs", "UserToZoneRoles", "CalendarCache",
           "EVERYONE_KEY", "UNGROUPED_FILTER_KEY",
           "IntegrityError", "COUNT_STAR", "SQL_ONE",
           'ACCOUNT_TYPE_ADMIN','ACCOUNT_TYPE_USER','ACCOUNT_TYPE_BLOCKED','ACCOUNT_TYPE_GROUP',
           'ZONE_ROLE_ADMIN', 'ZONE_ROLE_USER', 'ZONE_ROLE_VIEWER',
           'ZONE_TYPE_DISABLED', 'ZONE_TYPE_ENABLED', 'ZONE_TYPE_PUBLIC_VIEW', 'ZONE_TYPE_PUBLIC_BOOK']

DB_SCHEMA_FILE = "sql/schema.sql"
DB_MIGRATIONS = [
    (1, "sql/migration_001_days_in_advance.sql"),
    (2, "sql/migration_002_zone_type.sql"),
    (3, "sql/migration_003_seat_assign_everyone.sql"),
    (4, "sql/migration_004_user_prefs.sql"),
    (5, "sql/migration_005_ical.sql"),
    (6, "sql/migration_006_calendar_reminders.sql"),
    (7, "sql/migration_007_calendar_cache.sql"),
    (8, "sql/migration_008_zone_default_type.sql"),
    (9, "sql/migration_009_zone_preview_prefs.sql"),
    (10, "sql/migration_010_zone_group_text.sql"),
    (11, "sql/migration_011_plans.sql"),
    (12, "sql/migration_012_calendar_type_filter.sql"),
    (13, "sql/migration_013_default_plan.sql"),
    (14, "sql/migration_014_show_assigned_names.sql"),
    (15, "sql/migration_015_expand_user_to_zone_roles.sql"),
    (16, "sql/migration_016_group_account_type.sql"),
    (17, "sql/migration_017_plan_dark_filter.sql"),
]

DB_ADVISORY_LOCK_KEY = 7484381

def _connect():
    DB.connect()

def _disconnect(ctx):
    DB.close()

def init(app):

    global DB

    address = app.config['DATABASE_ADDRESS']
    host, _, port = address.rpartition(':')
    if not host:
        host, port = address, '5432'
    connArgs = app.config.get('DATABASE_ARGS', {})

    DB = Psycopg3Database(
        app.config['DATABASE_NAME'],
        host=host,
        port=int(port),
        user=app.config['DATABASE_USER'],
        password=app.config['DATABASE_PASSWORD'],
        autoconnect=False,
        thread_safe=True,
        **connArgs,
    )

    Blobs.bind(DB)
    Users.bind(DB)
    Groups.bind(DB)
    Plan.bind(DB)
    Seat.bind(DB)
    Zone.bind(DB)
    ZoneAssign.bind(DB)
    Book.bind(DB)
    SeatAssign.bind(DB)
    UserPrefs.bind(DB)
    UserToZoneRoles.bind(DB)
    CalendarCache.bind(DB)

    app.before_request(_connect)
    app.teardown_request(_disconnect)

    with app.app_context():
        initDB()

def initDB():

    schema = DB_SCHEMA_FILE

    preScripts = current_app.config.get('DATABASE_PRE_INIT_SCRIPTS', [])
    postScripts = current_app.config.get('DATABASE_POST_INIT_SCRIPTS', [])

    retries = current_app.config['DATABASE_INIT_RETRIES']
    retDelay = current_app.config['DATABASE_INIT_RETRIES_DELAY']

    if retries < 1:
        retries = 1

    while True:

        try:

            with DB:

                DB.execute_sql(f"SELECT pg_advisory_xact_lock({DB_ADVISORY_LOCK_KEY})")

                table_exists = False
                column_exists = False
                table_exists, column_exists = DB.execute_sql(
                    "SELECT "
                    "EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'db_initialized' AND table_schema = current_schema()), "
                    "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'db_initialized' AND column_name = 'version' AND table_schema = current_schema())"
                ).fetchone()

                if table_exists:
                    if not column_exists:
                        DB.execute_sql("ALTER TABLE db_initialized ADD COLUMN version INTEGER NOT NULL DEFAULT 0")
                        DB.execute_sql("INSERT INTO db_initialized (version) VALUES (0)")
                        current_version = 0
                    else:
                        current_version = DB.execute_sql("SELECT version FROM db_initialized LIMIT 1").fetchone()[0]

                    migration_scripts = DB_MIGRATIONS
                    for target_version, script in sorted(migration_scripts):
                        if target_version > current_version:
                            print(f'Executing migration script: {script}')
                            with current_app.open_resource(script) as f:
                                DB.execute(SQL(f.read().decode('utf8')))
                            DB.execute_sql("UPDATE db_initialized SET version = %s", (target_version,))

                    break

                print('Initializing DB')

                for script in preScripts:

                    print(f'Executing SQL (pre-init): {script}')

                    with current_app.open_resource(script) as f:
                        sql = f.read().decode('utf8')
                        DB.execute(SQL(sql))

                print(f'Executing SQL (schema): {schema}')

                with current_app.open_resource(schema) as f:
                    sql = f.read().decode('utf8')
                    DB.execute(SQL(sql))

                for script in postScripts:

                    print(f'Executing SQL (post-init): {script}')

                    with current_app.open_resource(script) as f:
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
