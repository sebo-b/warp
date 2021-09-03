import flask
from flask import app
from werkzeug.utils import redirect
from .db import getDB
from . import auth
from . import utils
from jsonschema import validate, ValidationError
from sqlite3.dbapi2 import Error, IntegrityError
import xlsxwriter
import io

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

    db = getDB()

    res = {}

    zoneGroupCursor = getDB().cursor()
    zoneGroupCursor.execute("SELECT zone_group FROM zone WHERE id = ?",(zid,))

    zoneGroup = zoneGroupCursor.fetchone()

    if zoneGroup is None:
        flask.abort(404)
    else:
        zoneGroup = zoneGroup[0]

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    assignCursor = getDB().cursor()
    assignCursor.execute("SELECT a.sid, u.login, u.name FROM assign a " \
                         " JOIN users u ON a.uid = u.id")

    assignments = {}
    for r in assignCursor:
        if r['sid'] not in assignments:
            assignments[r['sid']] = { 'logins': [], 'names': []}
        assignments[r['sid']]['logins'].append(r['login'])
        assignments[r['sid']]['names'].append(r['name'])

    seatsCursor = getDB().cursor()
    seatsCursor.execute("SELECT s.*, CASE WHEN a.sid IS NOT NULL THEN TRUE ELSE FALSE END assigned_to_me, CASE WHEN a.sid IS NULL AND ac.count > 0 THEN TRUE ELSE FALSE END assigned FROM seat s" \
                                " JOIN zone z ON s.zid = z.id" \
                                " LEFT JOIN assign a ON s.id = a.sid AND a.uid = ?"
                                " LEFT JOIN (SELECT sid,COUNT(*) count FROM assign GROUP BY sid) ac ON s.id = ac.sid"
                                " WHERE z.zone_group = ?" \
                                " AND (? OR enabled IS TRUE)",
                                (uid,zoneGroup,role <= auth.ROLE_MANAGER))

    for s in seatsCursor:

        assigned = s['assigned']
        if s['assigned_to_me']:
            assigned = 2

        res[s['id']] = {
            "name": s['name'],
            "x": s['x'],
            "y": s['y'],
            "zid": s['zid'],
            "enabled": s['enabled'] != 0,
            "assigned": assigned,
            "book": []
        }

        if s['id'] in assignments:
            if role <= auth.ROLE_MANAGER:
                res[s['id']]['assignments'] = assignments[s['id']]['logins']
            else:
                res[s['id']]['assignments'] = assignments[s['id']]['names']

    tr = utils.getTimeRange()
    
    bookingsCursor = getDB().cursor()
    bookingsCursor.execute("SELECT b.*, u.name username FROM book b" \
                           " JOIN users u ON u.id = b.uid" \
                           " JOIN seat s ON b.sid = s.id" \
                           " JOIN zone z ON s.zid = z.id" \
                           " WHERE b.fromTS < ? AND b.toTS > ?" \
                           " AND z.zone_group = ?" \
                           " AND (? OR s.enabled IS TRUE)" \
                           " ORDER BY fromTS",
                           (tr['toTS'],tr['fromTS'],zoneGroup,role <= auth.ROLE_MANAGER))

    for b in bookingsCursor:

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

    db = getDB()

    conflicts_in_disable = None
    conflicts_in_assign = None

    try:
        cursor = getDB().cursor()

        if 'enable' in apply_data:

            stmt = "UPDATE seat SET enabled=TRUE WHERE id in (" + \
                   ",".join(['?']*len(apply_data['enable'])) + \
                   ")"

            cursor.execute(stmt,apply_data['enable'])

        if 'disable' in apply_data:

            ts = utils.getTimeRange(True)

            stmt = "SELECT b.*, u.login, u.name FROM book b" \
                   " JOIN users u ON b.uid = u.id" \
                   " WHERE b.fromTS < ? AND b.toTS > ?" \
                   " AND b.sid IN (" + \
                   (",".join(['?']*len(apply_data['disable']))) + \
                   ")"

            cursor.execute(stmt, [ts['toTS'],ts['fromTS']]+apply_data['disable'])

            conflicts_in_disable = [
                {
                    "sid": row['sid'],
                    "fromTS": row['fromts'],
                    "toTS": row['tots'],
                    "login": row['login'],
                    "username": row['name']
                } for row in cursor
            ]

            stmt = "UPDATE seat SET enabled=FALSE WHERE id IN (" + \
                   ",".join(['?']*len(apply_data['disable'])) + \
                   ")"

            cursor.execute(stmt, apply_data['disable'])

        if 'assign' in apply_data:

            cursor.execute("DELETE FROM assign WHERE sid = ?", (apply_data['assign']['sid'],))

            if len(apply_data['assign']['logins']):

                stmt = "INSERT INTO assign (sid,uid) SELECT ?, id FROM users WHERE LOGIN IN (" + \
                       ",".join(['?']*len(apply_data['assign']['logins'])) + \
                       ")"

                cursor.execute(stmt, [apply_data['assign']['sid']]+apply_data['assign']['logins'])

                if cursor.rowcount != len(apply_data['assign']['logins']):
                    raise Error("Number of affected row is different then in assign.logins.")

                ts = utils.getTimeRange(True)

                stmt = "SELECT b.*, u.login, u.name FROM book b" \
                            " JOIN users u ON b.uid = u.id" \
                            " WHERE b.fromTS < ? AND b.toTS > ?" \
                            " AND b.sid = ?" \
                            " AND u.login NOT IN (" + \
                            ",".join(['?']*len(apply_data['assign']['logins'])) + \
                            ")"

                cursor.execute(stmt, [ts['toTS'],ts['fromTS'],apply_data['assign']['sid']]+apply_data['assign']['logins'] )
                
                conflicts_in_assign = [
                    {"sid": row['sid'],
                     "fromTS": row['fromts'],
                     "toTS": row['tots'],
                     "login": row['login'],
                     "username": row['name']} for row in cursor]

        # befor book we have to remove reservations (as this can be list of conflicting reservations)
        if 'remove' in apply_data:
            cursor.executemany("DELETE FROM book WHERE id = ? AND (? OR uid = ?)",
                ((id,role < auth.ROLE_USER,uid) for id in apply_data['remove']))

            if cursor.rowcount != len(apply_data['remove']):
                raise Error("Number of affected row is different then in remove.")

        # then we create new reservations
        if 'book' in apply_data:

            cursor.execute("SELECT enabled FROM seat WHERE id = ?",(apply_data['book']['sid'],))
            seatEnabled = cursor.fetchone()
            if not seatEnabled['enabled']:
                raise Error("Booking a disabled seat is forbidden.")

            cursor.executemany("INSERT INTO book (uid,sid,fromTS,toTS) VALUES (?,?,?,?)",
                ((uid,apply_data['book']['sid'],x['fromTS'], x['toTS']) for x in apply_data['book']['dates']))

        db.commit()

    except Error as err:
        db.rollback()
        return {"msg": "Error" }, 400
    except:
        db.rollback()
        raise

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

    usersCursor = getDB().cursor()
    usersCursor.execute("SELECT id,login,name,role FROM users")

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

    usersCursor = getDB().cursor()
    usersCursor.execute("SELECT id FROM users WHERE login = ?",(action_data['login'],))
    user = usersCursor.fetchone()

    if user is None:
        return {"msg": "not found"}, 404

    if not flask.session.get('real-uid'):
        flask.session['real-uid'] = flask.session.get('uid')

    flask.session['uid'] = user['id']

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

    cursor = getDB().cursor()

    try:

        passHash = None
        if 'password' in action_data and len(action_data['password']) > 0:
            passHash = generate_password_hash(action_data['password'])

        if action_data['action'] == "update":

            cursor.execute("UPDATE users SET" \
                                " name = ?, role = ?" \
                                " WHERE login = ? AND role >= ?",
                                (action_data['name'], action_data['role'], action_data['login'], role))
            if cursor.rowcount != 1:
                raise Error("Wrong number of affected rows")

            if passHash:

                cursor.execute("UPDATE users SET password = ?" \
                               " WHERE login = ? AND role >= ?",
                                (passHash, action_data['login'], role))
                if cursor.rowcount != 1:
                    raise Error("Wrong number of affected rows")

        elif action_data['action'] == "add":
            cursor.execute("INSERT INTO users(login, name, role, password) VALUES (?,?,?,?)",
                            (action_data['login'],action_data['name'], action_data['role'], passHash)) 
            if cursor.rowcount != 1:
                raise Error("Wrong number of affected rows")

        elif action_data['action'] == "delete":
            cursor.execute("DELETE FROM users WHERE login = ? AND role >= ?",
                            (action_data['login'],role)) 
            if cursor.rowcount != 1:
                raise Error("Wrong number of affected rows")

        getDB().commit()

    except IntegrityError as err:
        getDB().rollback()
        if action_data['action'] == "delete":
            return {"msg": "User cannot be deleted" }, 400
        elif action_data['action'] == "add":
            return {"msg": "Login exits" }, 400
        else:
            return {"msg": "Error" }, 400
    except Error as err:
        getDB().rollback()
        return {"msg": "Error" }, 400
    except:
        getDB().rollback()
        raise

    cursor.execute("SELECT login,name,role FROM users WHERE login = ?", (action_data['login'],))
    row = cursor.fetchone()

    if row:

        return flask.jsonify([{
            "login": row['login'],
            "name": row['name'],
            "role": row['role']
            }])
    
    else:

        return flask.jsonify([{"login": action_data['login']}])

# Format
@bp.route("/bookings/get")
def bookingsGet():

    uid = flask.session.get('uid')
    role = flask.session.get('role')

    db = getDB()
    tr = utils.getTimeRange()

    cursor = getDB().cursor()
    cursor.execute("SELECT b.id bid,u.id uid, u.name user_name, u.login login, z.name zone_name, s.name seat_name, fromTS, toTS FROM book b" \
                              " JOIN seat s ON b.sid = s.id"
                              " JOIN zone z ON s.zid = z.id"
                              " JOIN users u ON b.uid = u.id"
                              " WHERE fromTS < ? AND toTS > ?",
                              (tr["toTS"],tr["fromTS"]))

    res = []
    
    for row in cursor:

        can_edit = True if row['uid'] == uid else False
        if role >= auth.ROLE_VIEVER:
            can_edit = False
        elif role <= auth.ROLE_MANAGER:
            can_edit = True

        res.append({
            "bid": row["bid"],
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

    db = getDB()

    columnsMap = {
        "id": "b.id",
        "user_name": "u.name",
        "login": "u.login",
        "zone_name": "z.name",
        "seat_name": "s.name",
        "fromTS": "b.fromts",
        "toTS": "b.tots"
    }

    sqlSort = []
    if "sorters" in requestData:
        for i in requestData['sorters']:
            if i["field"] in columnsMap:
                sqlSort.append(columnsMap[i["field"]] + " " + i["dir"])

    if len(sqlSort):
        sqlSort = " ORDER BY " + ",".join(sqlSort)
    else:
        sqlSort = ""

    sqlParams = []

    sqlFilters = []
    if "filters" in requestData:
        for i in requestData['filters']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] == 'starts':
                    sqlFilters.append(field + " LIKE ?")
                    sqlParams.append(i["value"]+"%")
                else:   # json schema allows only <= and >=
                    sqlFilters.append(field + " " + i["type"] + " ?")
                    sqlParams.append(i["value"])

    if len(sqlFilters):
        sqlFilters = " WHERE " + " AND ".join(sqlFilters)
    else:
        sqlFilters = ""

    lastPage = None

    sqlLimit = ""
    if "size" in requestData:

        limit = requestData['size']
        sqlLimit = sqlLimit + " LIMIT ?"
        sqlLimitParams = [limit]

        if "page" in requestData:

            countCursor = getDB().cursor()
            countCursor.execute("SELECT COUNT(*) FROM book b" \
                                        " JOIN seat s ON b.sid = s.id" \
                                        " JOIN zone z ON s.zid = z.id" \
                                        " JOIN users u ON b.uid = u.id" + sqlFilters, sqlParams)
            count = countCursor.fetchone()[0]
            
            lastPage = -(-count // limit)   # round up

            sqlLimit = sqlLimit + " OFFSET ?"
            offset = (requestData['page']-1)*requestData['size']
            sqlLimitParams.append(offset)

        sqlParams.extend(sqlLimitParams)

    dataCursor = getDB().cursor()
    dataCursor.execute("SELECT b.id id, u.name user_name, login login, z.name zone_name, s.name seat_name, fromTS, toTS FROM book b" \
                              " JOIN seat s ON b.sid = s.id" \
                              " JOIN zone z ON s.zid = z.id" \
                              " JOIN users u ON b.uid = u.id" +
                              sqlFilters + sqlSort + sqlLimit,
                              sqlParams)

    if "export" in requestData:
        # only xlsx for now

        memoryBuffer = io.BytesIO()

        workbook = xlsxwriter.Workbook(memoryBuffer, {'in_memory': True})
        worksheet = workbook.add_worksheet()

        columnsHeader = [ "User name", "Login", "Zone name", "Seat name", "From", "To" ]
        columnsContent = [ "user_name", "login", "zone_name", "seat_name", "fromts", "tots" ]

        worksheet.write_row(0,0,columnsHeader)

        for rowNo,dbRow in enumerate(dataCursor,1):

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

        for row in dataCursor:

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