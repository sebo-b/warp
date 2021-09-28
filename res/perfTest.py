from peewee import SqliteDatabase, Table, SQL, fn, IntegrityError
import playhouse.db_url
from time import perf_counter_ns


class PerfMeasure:

    def __init__(self, tick = False):
        self.list = []
        if tick:
            self.list.append((perf_counter_ns(),None))

    def tick(self, msg = None):
        self.list.append(
            (perf_counter_ns(),msg))

    def print(self):

        if len(self.list) < 2:
            return

        last = None
        for val in self.list:

            if val[1] is not None and last is not None:
                delta = (val[0] - last)/1e6
                print(f"{val[1]}: {delta}ms")
            
            last = val[0]


DATABASE = "postgresql://warp@localhost:5432/warp"
DATABASE_ARGS = {}
DATABASE = "sqlite:///../warp/db.sqlite"
DATABASE_ARGS = {"pragmas": {"foreign_keys": "ON"}}

DB = playhouse.db_url.connect(DATABASE, autoconnect=False, thread_safe=True, **DATABASE_ARGS)

Book = Table('book',('id','uid','sid','fromts','tots'))
Users = Table('users',('id','login','password','name','role'))
Zone = Table('zone',('id','zone_group','name','image'))
Seat = Table('seat',('id','zid','name','x','y','enabled'))

p = PerfMeasure()

bookQuery = Book.select(Book.id, Book.uid, Book.sid, Users.name.alias('username'), Book.fromts, Book.tots) \
                        .join(Users, on=(Book.uid == Users.id)) \
                        .join(Seat, on=(Book.sid == Seat.id)) \
                        .join(Zone, on=(Seat.zid == Zone.id)) \
                        .order_by(Book.fromts)


seatQuery = Seat.select(Seat.id).tuples()
seat_templ = {}

with DB.connection_context():

    for s in seatQuery.execute(DB):
        seat_templ[s[0]] = {"sid": s[0], "book": [] }


seat = seat_templ.copy()
uid = 5

with DB.connection_context():

    p.tick()

    for b in DB.execute(bookQuery):

        sid = b[2]

        seat[sid]['book'].append({ 
            "bid": b[0],
            "isMine": b[1] == uid,
            "username": b[3],
            "fromTS": b[4], 
            "toTS": b[5] })

    p.tick("DB.execute")

seat1 = seat_templ.copy()

with DB.connection_context():

    p.tick()

    for b in bookQuery.execute(DB):

        sid = b['sid']

        seat1[sid]['book'].append({
            "bid": b['id'],
            "isMine": b['uid'] == uid,
            "username": b['username'],
            "fromTS": b['fromts'], 
            "toTS": b['tots'] })

    p.tick("bookQuery")

p.tick()
seat2 = seat | seat1
p.tick("merge")

seat = seat_templ.copy()
bookQuery = bookQuery.clone()

with DB.connection_context():

    p.tick()

    for b in bookQuery.iterator(DB):

        sid = b['sid']

        seat[sid]['book'].append({
            "bid": b['id'],
            "isMine": b['uid'] == uid,
            "username": b['username'],
            "fromTS": b['fromts'], 
            "toTS": b['tots'] })

    p.tick("bookQuery.iterator()")

seat = seat_templ.copy()
bookQuery = bookQuery.tuples()  # this clones bookQuery

with DB.connection_context():

    p.tick()

    for b in bookQuery.iterator(DB):

        sid = b[2]

        seat[sid]['book'].append({
            "bid": b[0],
            "isMine": b[1] == uid,
            "username": b[3],
            "fromTS": b[4], 
            "toTS": b[5] })

    p.tick("bookQuery.tuples().iterator()")

seat = seat_templ.copy()

with DB.connection_context():

    
    p.tick()

    cursor = DB.execute(bookQuery)
    data = cursor.fetchall()

    p.tick("DB.execute + fetchall")

    for b in data:

        sid = b[2]

        seat[sid]['book'].append({
            "bid": b[0],
            "isMine": b[1] == uid,
            "username": b[3],
            "fromTS": b[4], 
            "toTS": b[5] })

    p.tick("DB.execute + fetchall + for")

p.print()
