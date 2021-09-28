from calendar import timegm
from time import localtime,strftime,gmtime
import random

from peewee import SqliteDatabase, Table, SQL, fn, IntegrityError
import playhouse.db_url

DAYS = 14
NO_OF_SEATS = 500
NO_OF_USERS = 600

ZONES = [1, 2]

SLOT = 15*60

MAX_LEN = 24    # booking max len in slots

GAPE_0_PROB = 5 # probability of 0 gape
MAX_GAPE = 4    # in slots

GAPE_ARR = [0]*GAPE_0_PROB + list(range(1,MAX_GAPE+1))
DAY_LEN = (24*3600 / SLOT)

DATABASE = "postgresql://warp@localhost:5432/warp"
DATABASE_ARGS = {}
#DATABASE = "sqlite:///../warp/db.sqlite"
#DATABASE_ARGS = {"pragmas": {"foreign_keys": "ON"}}

DB = playhouse.db_url.connect(DATABASE, autoconnect=False, thread_safe=True, **DATABASE_ARGS)

Book = Table('book',('id','uid','sid','fromts','tots')).bind(DB)
Users = Table('users',('id','login','password','name','role')).bind(DB)
Seat = Table('seat',('id','zid','name','x','y','enabled')).bind(DB)


def midnight():
    midnight = timegm(localtime())
    midnight = midnight + (24*3600) - midnight % (24*3600)
    return midnight


def generateTableData():

    from math import sqrt, ceil, floor

    Book.delete().execute()
    Seat.delete().execute()

    space = 50
    len = ceil(sqrt(NO_OF_SEATS))
    for seat in range(NO_OF_SEATS):
        x = (seat % len) * space
        y = floor(seat / len) * space
        zone = random.choice(ZONES)
        name = f"S.{seat}"
        Seat.insert({
            'id': seat,
            'zid': zone,
            'name': name,
            'x': x,
            'y': y,
            'enabled': True
        }).execute()

    Users.delete().execute()
    for u in range(NO_OF_USERS):
        
        Users.insert({
            'id': u,
            'login': f"user{u}",
            'password': 'pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc',
            'name': f"User no {u}",
            'role': 2
        }).execute()

    Users.insert({
        'id': u+1,
        'login': 'admin',
        'password': 'pbkdf2:sha256:260000$UEV4fnkO1Mtr5EBq$4624e65fae621ec38b6e6c47f49642a120dd91e2dc8c10477b5128b8de4b14dc',
        'name': "Admin",
        'role': 1
    }).execute()

with DB:

    generateTableData()

    currTS = midnight()

    for day in range(DAYS):

        data = [ [] for x in range(NO_OF_SEATS)]

        for seat in range(NO_OF_SEATS):

            fromts = 0
            while fromts < DAY_LEN:

                fromts = fromts + random.choice(GAPE_ARR)
                remaining = min(DAY_LEN - fromts, MAX_LEN)
                
                if remaining < 3:
                    break

                tots = fromts + random.randrange(2,remaining)

                users = {x for x in range(NO_OF_USERS)}

                for x in data[:seat]:
                    for y in x:
                        if y['fromts'] < tots and y['tots'] > fromts:
                            users.discard(y['uid'])

                if len(users) > 1:

                    user = random.choice(tuple(users))

                    data[seat].append( {
                        'sid': seat,
                        'fromts': fromts,
                        'tots': tots,
                        'uid': user
                    })

                fromts = tots

        for seat in data:
            for x in seat:
                x['fromts'] = x['fromts']*SLOT + currTS
                x['tots'] = x['tots']*SLOT + currTS
                Book.insert(x).execute()

        currTS = currTS + 3600*24

