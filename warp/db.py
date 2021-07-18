import sqlite3
import os
from flask import current_app, g
from flask.cli import with_appcontext
import click

def getDB():

    if 'database' not in g:
        db_file = os.path.join(current_app.root_path, current_app.config['DATABASE'])
        g.database = sqlite3.connect(db_file)
        g.database.row_factory = sqlite3.Row

        g.database.cursor().execute("PRAGMA foreign_keys = ON")

    return g.database

def closeDB(error):
    db = g.pop('database', None)
    if db is not None:
        db.close()

@click.command('init-db', help = "Create and initialize database.")
@click.option('-s','--sample-data','sample_data', is_flag = True, default = False, help = "Pupulate database with a sample data.")
@with_appcontext
def initDB(sample_data):

    db = getDB()

    with current_app.open_resource('sql/schema.sql') as f:
        db.executescript(f.read().decode('utf8'))
    click.echo('The database initialized.')

    if sample_data:
        with current_app.open_resource('sql/sample_data.sql') as f:
            db.executescript(f.read().decode('utf8'))
        click.echo('Sample data inserted.')
