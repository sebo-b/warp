import flask
from flask import app
from werkzeug.utils import redirect
from . import auth
from . import utils
from jsonschema import validate, ValidationError
import xlsxwriter
import io

from .db import *

bp = flask.Blueprint('xhr', __name__)

#Format JSON
#    sidN: { 
#       name: "name", 
#       x: 10, y: 10, 
#       zid: zid, 
#       enabled: true|false, 
#       assigned: 0, 1, 2 (look at WarpSeat.SeatAssignedStates in seat.js)
#       book: [
#           { bid: 10, isMine: true, username: "sebo", fromTS: 1, toTS: 2 }
#       assignments: [ login1, login2, ... ]        #only for admin
#       assignments: [ name1, name2, ... ]          #for non-admins
# note that book array is sorted on fromTS
@bp.route("/zone/getSeats/<zid>")
def zoneGetSeats(zid):

    res = {}

    zoneGroupCursor = Zone.select(Zone.zone_group).where(Zone.id == zid)

    if len(zoneGroupCursor) != 1:
        flask.abort(404)
    else:
        zoneGroup = zoneGroupCursor[0]['zone_group']

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    assignCursor = Assign.select(Assign.sid, Assign.uid, Users.login, Users.name).join(Users,on=(Assign.uid == Users.id))

    assignments = {}
    for r in assignCursor:

        if r['sid'] not in assignments:
            assignments[r['sid']] = { 'assigned_to_me': False, 'logins': [], 'names': []}

        if r['uid'] == uid:
            assignments[r['sid']]['assigned_to_me'] = True

        assignments[r['sid']]['logins'].append(r['login'])
        assignments[r['sid']]['names'].append(r['name'])

    seatsCursor = Seat.select(Seat.id, Seat.name, Seat.x, Seat.y, Seat.zid, Seat.enabled) \
                      .join(Zone, on=(Seat.zid == Zone.id)) \
                      .where(Zone.zone_group == zoneGroup)

    if role > auth.ROLE_MANAGER:
        seatsCursor = seatsCursor.where(Seat.enabled == True)

    for s in seatsCursor:

        seatD = {
            "name": s['name'],
            "x": s['x'],
            "y": s['y'],
            "zid": s['zid'],
            "enabled": s['enabled'] != 0,
            "assigned": 0,
            "book": []
        }

        if s['id'] in assignments:
            
            assign = assignments[s['id']]

            # NOT_ASSIGNED: 0,
            # ASSIGNED: 1,    // not to me
            # ASSIGNED_TO_ME: 2
            seatD['assigned'] = 2 if assign['assigned_to_me'] else 1
            seatD['assignments'] = assign['logins'] if role <= auth.ROLE_MANAGER else assign['names']
            
        res[s['id']] = seatD

    tr = utils.getTimeRange()
    
    bookQuery = Book.select(Book.id, Book.uid, Book.sid, Users.name.alias('username'), Book.fromts, Book.tots) \
                         .join(Users, on=(Book.uid == Users.id)) \
                         .join(Seat, on=(Book.sid == Seat.id)) \
                         .join(Zone, on=(Seat.zid == Zone.id)) \
                         .where((Book.fromts < tr['toTS']) & (Book.tots > tr['fromTS']) & (Zone.zone_group == zoneGroup)) \
                         .order_by(Book.fromts)
    
    if role > auth.ROLE_MANAGER:
        bookQuery = bookQuery.where(Seat.enabled == True)

    for b in bookQuery.iterator():

        sid = b['sid']

        res[sid]['book'].append({ 
            "bid": b['id'],
            "isMine": b['uid'] == uid,
            "username": b['username'],
            "fromTS": b['fromts'], 
            "toTS": b['tots'] })

    return flask.jsonify(res)

# format:
# { 
#   enable: [ sid, sid, ...],
#   disable: [ sid, sid, ...],
#   assign: {
#       sid: sid,
#       logins: [ login, login, ... ]
#   },
#   book: {
#       sid: sid,
#       dates: [
#           { fromTS: timestamp, toTS: timestamp },
#           { fromTS: timestamp, toTS: timestamp },
#       ]
#   },
#   remove: [ bid, bid, bid]
# }
@bp.route("/zone/apply", methods=["POST"])
def zoneApply():

    if not flask.request.is_json:
        flask.abort(404)

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    if role >= auth.ROLE_VIEVER:
        flask.abort(403)

    apply_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {
            "enable": {
                "type": "array",
                "items": {
                    "type": "integer"
                },
            },
            "disable": {
                "type": "array",
                "items": {
                    "type": "integer"
                },
            },
            "assign": {
                "type": "object",
                "properties": {
                    "sid" : {"type" : "integer"},
                    "logins": {
                        "type": "array",
                        "items": {
                            "type": "string",
                        },
                    },
                },
            },
            "book": {
                "type": "object",
                "properties": {
                    "sid" : {"type" : "integer"},
                    "dates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "fromTS": {"type" : "integer"},
                                "toTS": {"type" : "integer"}
                            },
                            "required": [ "fromTS", "toTS"]
                        }                       
                    }
                },
                "required": [ "sid", "dates"],
            },
            "remove": {
                "type": "array",
                "items": {
                    "type": "integer"
                }
            }
        },
        "anyOf": [
            {"required": [ "enable" ]},
            {"required": [ "disable" ]},
            {"required": [ "assign" ]},
            {"required": [ "book" ]},
            {"required": [ "remove" ]}
        ]
    }

    if role >= auth.ROLE_USER:
        ts = utils.getTimeRange()
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["fromTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["fromTS"]["maximum"] = ts["toTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["toTS"]["minimum"] = ts["fromTS"]
        schema["properties"]["book"]["properties"]['dates']['items']["properties"]["toTS"]["maximum"] = ts["toTS"]

    try:
        validate(apply_data,schema)
    except ValidationError as err:
        return {"msg": "invalid input" }, 400

    if ('enable' in apply_data or 'disable' in apply_data or 'assign' in apply_data) and role > auth.ROLE_MANAGER:
        return {"msg": "Forbidden" }, 403

    conflicts_in_disable = None
    conflicts_in_assign = None

    class WarpErr(Exception):
        pass

    try:

        with DB.atomic():

            if 'enable' in apply_data:

                Seat.update({Seat.enabled: True}).where(Seat.id.in_(apply_data['enable'])).execute()

            if 'disable' in apply_data:

                ts = utils.getTimeRange(True)

                query = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                            .join(Users, on=(Book.uid == Users.id)) \
                            .where((Book.fromts < ts['toTS']) & (Book.tots > ts['fromTS'])) \
                            .where(Book.sid.in_(apply_data['disable']))

                conflicts_in_disable = [
                    {
                        "sid": row['sid'],
                        "fromTS": row['fromts'],
                        "toTS": row['tots'],
                        "login": row['login'],
                        "username": row['name']
                    } for row in query
                ]

                Seat.update({Seat.enabled: False}).where(Seat.id.in_(apply_data['disable'])).execute()

            if 'assign' in apply_data:

                Assign.delete().where(Assign.sid == apply_data['assign']['sid']).execute()

                if len(apply_data['assign']['logins']):

                    rowCount = Assign.insert(
                        Users.select(apply_data['assign']['sid'],Users.id).where(Users.login.in_(apply_data['assign']['logins'])),
                        (Assign.sid, Assign.uid)
                    ).execute()
                    

                    if rowCount != len(apply_data['assign']['logins']):
                        raise WarpErr("Number of affected row is different then in assign.logins.")

                    ts = utils.getTimeRange(True)

                    query = Book.select(Book.sid, Book.fromts, Book.tots, Users.login, Users.name) \
                                .join(Users, on=(Book.uid == Users.id)) \
                                .where((Book.fromts < ts['toTS']) & (Book.tots > ts['fromTS'])) \
                                .where(Book.sid == apply_data['assign']['sid']) \
                                .where(Users.login.not_in(apply_data['assign']['logins']))

                    conflicts_in_assign = [
                        {"sid": row['sid'],
                        "fromTS": row['fromts'],
                        "toTS": row['tots'],
                        "login": row['login'],
                        "username": row['name']} for row in query]

            # befor book we have to remove reservations (as this can be list of conflicting reservations)
            if 'remove' in apply_data:

                stmt = Book.delete().where(Book.id.in_(apply_data['remove']))

                if role > auth.ROLE_MANAGER:
                    stmt = stmt.where(Book.uid == uid)

                rowCount = stmt.execute()

                if rowCount != len(apply_data['remove']):
                    raise WarpErr("Number of affected row is different then in remove.")

            # then we create new reservations
            if 'book' in apply_data:
                
                stmt = Seat.select(True) \
                           .where( (Seat.id == apply_data['book']['sid']) & (Seat.enabled == False))

                if len(stmt):
                    raise WarpErr("Booking a disabled seat is forbidden.")

                insertData = [ {
                        Book.uid: uid,
                        Book.sid: apply_data['book']['sid'],
                        Book.fromts: x['fromTS'], 
                        Book.tots: x['toTS']
                    } for x in apply_data['book']['dates'] ]

                stmt = Book.insert(insertData)
                stmt.execute()


    except WarpErr as err:
        return {"msg": "Error" }, 400

    ret = { "msg": "ok" }

    if conflicts_in_disable:
        ret["conflicts_in_disable"] = conflicts_in_disable

    if conflicts_in_assign:
        ret["conflicts_in_assign"] = conflicts_in_assign

    return ret, 200


#Format
# {
#   data: {
#         login1: { name: "User 1", role: 1 }
#         login2: { name: "User 2", role: 2 }
#         ...    
#       },
#   login: user1
#   real_login: user2
#   role: 2
# }
@bp.route("/api/getUsers")
def getUsers():

    uid = flask.session.get('uid')
    real_uid = flask.session.get('real-uid')
    role = flask.session.get('role')

    if role > auth.ROLE_MANAGER:
        flask.abort(403)

    usersCursor = Users.select()

    res = {
        "data": {},
        "role": role
    }

    for u in usersCursor:

        res["data"][u["login"]] = {
            "name": u['name'],
            "role": u['role']
        }

        if u['id'] == uid:
            res["login"] = u['login']

        if real_uid and u['id'] == real_uid:
            res["real_login"] = u['login']

    if "real_login" not in res:
        res["real_login"] = res["login"]

    return res, 200

# Format
# { login: login }
@bp.route("/actas/set", methods=["POST"])
def actAsSet():

    if not flask.request.is_json:
        flask.abort(404)

    role = flask.session.get('role')

    if role > auth.ROLE_MANAGER:
        flask.abort(403)

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {
            "login" : {"type" : "string"}
        }
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "invalid input" }, 400

    usersCursor = Users.select(Users.id).where(Users.login == action_data['login'])

    if len(usersCursor) != 1:
        return {"msg": "not found"}, 404

    if not flask.session.get('real-uid'):
        flask.session['real-uid'] = flask.session.get('uid')

    flask.session['uid'] = usersCursor[0]['id']

    return {"msg": "ok"}, 200

##
# Format:
# { login: login, name: name, role: role, password: plain_text, action: "add|update|delete" }
# return array (now of length 1) of updated/created row
@bp.route("/api/editUser", methods=["POST"])
def editUser():

    from werkzeug.security import generate_password_hash

    if not flask.request.is_json:
        flask.abort(404)

    role = flask.session.get('role')

    if role > auth.ROLE_MANAGER:
        flask.abort(403)

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "login" : {"type" : "string"},
            "name" : {"type" : "string"},
            "role" : {"type" : "integer", "minimum": role },
            "password" : {"type" : "string"},
            "action": {"enum": ["add", "delete","update"]}
        },
        "allOf": [
            {
                "required": [ "login", "action"]
            },
            {
                "if": {
                    "properties": {
                        "action": {
                            "enum": ["add","update"]
                        }
                    }
                },
                "then": {
                    "required": [ "name", "role" ]
                }
            },
            {
                "if": {
                    "properties": {
                        "action": {
                            "const": "add"
                        }
                    }
                },
                "then": {
                    "required": [ "password" ]
                }
            }
        ]
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "Data error" }, 400

    class WarpErr(Exception):
        pass

    try:

        with DB.atomic():

            passHash = None
            if 'password' in action_data and len(action_data['password']) > 0:
                passHash = generate_password_hash(action_data['password'])

            if action_data['action'] == "update":

                if action_data['role'] < role:
                    raise WarpErr('Cannot set higher role than yours')

                updColumns = {
                    Users.name: action_data['name'],
                    Users.role: action_data['role'],
                }

                if passHash:
                    updColumns[Users.password] = passHash

                rowCount = Users.update(updColumns) \
                                .where((Users.login == action_data['login']) & (Users.role >= role)) \
                                .execute()

                if rowCount != 1:
                    raise WarpErr("Wrong number of affected rows")

            elif action_data['action'] == "add":

                if action_data['role'] < role:
                    raise WarpErr('Cannot add user with higher role than yours')

                Users.insert({ 
                    Users.login: action_data['login'],
                    Users.name: action_data['name'],
                    Users.role: action_data['role'],
                    Users.password: passHash
                }).execute()

            elif action_data['action'] == "delete":
                
                rowCount = Users.delete() \
                                .where((Users.login == action_data['login']) & (Users.role >= role)) \
                                .execute()
                
                if rowCount != 1:
                    raise WarpErr("Wrong number of affected rows")

    except IntegrityError as err:
        if action_data['action'] == "delete":
            return {"msg": "User cannot be deleted" }, 400
        elif action_data['action'] == "add":
            return {"msg": "Login exits" }, 400
        else:
            return {"msg": "Error" }, 400
    except WarpErr as err:
        return {"msg": "Error" }, 400

    query = Users.select(Users.login, Users.name, Users.role).where(Users.login == action_data['login'])

    if len(query) == 0:
        return flask.jsonify([{"login": action_data['login']}])    
    else:
        return flask.jsonify([{
            "login": query[0]['login'],
            "name": query[0]['name'],
            "role": query[0]['role']
            }])


# Format
@bp.route("/bookings/get")
def bookingsGet():

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    tr = utils.getTimeRange()

    cursor = Book.select(Book.id, Book.uid, Users.name.alias('user_name'), Users.login, Zone.name.alias('zone_name'), Seat.name.alias('seat_name'), Book.fromts, Book.tots) \
                 .join(Seat, on=(Book.sid == Seat.id)) \
                 .join(Zone, on=(Seat.zid == Zone.id)) \
                 .join(Users, on=(Book.uid == Users.id)) \
                 .where((Book.fromts < tr["toTS"]) & (Book.tots > tr["fromTS"]))

    res = []
    
    for row in cursor:

        if role >= auth.ROLE_VIEVER:
            can_edit = False
        elif role <= auth.ROLE_MANAGER:
            can_edit = True
        else:
            can_edit = row['uid'] == uid

        res.append({
            "bid": row["id"],
            "user_name": row["user_name"]+" ["+row["login"]+"]" if role <= auth.ROLE_MANAGER else row["user_name"],
            "zone_name": row["zone_name"],
            "seat_name": row["seat_name"],
            "fromTS": row["fromts"],
            "toTS": row["tots"],
            "can_edit": can_edit
        })

    return flask.jsonify(res)



@bp.route("/bookings/report", methods=["POST"])
def bookingsReport():

    if not flask.request.is_json:
        flask.abort(404)

    role = flask.session.get('role')

    if role > auth.ROLE_MANAGER:
        flask.abort(403)

    requestData = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "page" : {"type" : "integer"},
            "size" : {"type" : "integer"},
            "export": {"enum": ["xlsx"] },
            "sorters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field" : {"type" : "string"},
                        "dir" : {"enum" : ["asc", "desc"] }
                    },
                    "required": [ "field", "dir"],
                },
            },
            "filters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field" : {"type" : "string"},
                        "type" : {"enum" : ["starts", ">=","<="] }
                    },
                    "required": [ "field", "type", "value"],
                    "if": {
                        "properties": { "type" : {"enum" : ["starts"] } }
                    },
                    "then": {
                        "properties": { "value" : {"type" : "string" } }
                    },
                    "else": {
                        "properties": { "page" : {"type" : "integer" } }
                    },
                },
            },
        },
        "dependencies": {
            "page": ["size"]
        }
    }

    try:
        validate(requestData,schema)
    except ValidationError as err:
        return {"msg": "Data error" }, 400

    columnsMap = {
        "id": Book.id,
        "user_name": Users.name,
        "login": Users.login,
        "zone_name": Zone.name,
        "seat_name": Seat.name,
        "fromTS": Book.fromts,
        "toTS": Book.tots
    }

    query = Book.select(Book.id, Users.name.alias('user_name'), Users.login, Zone.name.alias('zone_name'), Seat.name.alias('seat_name'), Book.fromts, Book.tots) \
                      .join(Seat, on=(Book.sid == Seat.id)) \
                      .join(Zone, on=(Seat.zid == Zone.id)) \
                      .join(Users, on=(Book.uid == Users.id))

    if "filters" in requestData:
        for i in requestData['filters']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] == '<=':
                    query = query.where( field <= i["value"])
                elif i['type'] == '>=':
                    query = query.where( field >= i["value"])
                elif i['type'] == 'starts':
                    query = query.where( field.startswith(i["value"]))

    lastPage = None
    if "size" in requestData:

        limit = requestData['size']

        if "page" in requestData:
            
            countCursor = query.columns(COUNT_STAR.alias('count'))                            
            count = countCursor[0]['count']
            
            lastPage = -(-count // limit)   # round up
            
            offset = (requestData['page']-1)*requestData['size']
            query = query.offset(offset)
        
        query = query.limit(limit)

    if "sorters" in requestData:
        for i in requestData['sorters']:
            if i["field"] in columnsMap:
                query = query.order_by_extend( columnsMap[i["field"]].asc() if i["dir"] == "asc" else columnsMap[i["field"]].desc() )


    if "export" in requestData:
        # only xlsx for now

        memoryBuffer = io.BytesIO()

        workbook = xlsxwriter.Workbook(memoryBuffer, {'in_memory': True})
        worksheet = workbook.add_worksheet()

        columnsHeader = [ "User name", "Login", "Zone name", "Seat name", "From", "To" ]
        columnsContent = [ "user_name", "login", "zone_name", "seat_name", "fromts", "tots" ]

        worksheet.write_row(0,0,columnsHeader)

        for rowNo,dbRow in enumerate(query,1):

            rowData = []
            for i in columnsContent:
                if i[-2:] == "ts":
                    rowData.append( (dbRow[i] / 86400)+25569 )
                else:
                    rowData.append(dbRow[i])

            worksheet.write_row(rowNo,0,rowData)

        dateFormat = workbook.add_format({'num_format': 'yyyy-mm-dd hh:mm'})
        for colNo, col in enumerate(columnsContent):
            if col[-2:] == "ts":
                worksheet.set_column(colNo, colNo, None, dateFormat)

        workbook.close()

        memoryBuffer.seek(0)

        return flask.send_file(
            memoryBuffer,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            download_name="warp_export.xlsx"
        )

    else:

        res = {
            "data":[]
        }

        if lastPage is not None:
            res["last_page"] = lastPage

        for row in query:

            res['data'].append({
                "id": row["id"],
                "user_name": row["user_name"],
                "login": row["login"],
                "zone_name": row["zone_name"],
                "seat_name": row["seat_name"],
                "fromTS": row["fromts"],
                "toTS": row["tots"]
            })

        return flask.jsonify(res)