import flask
from jsonschema import validate, ValidationError

from warp import auth
from warp.db import *

bp = flask.Blueprint('users', __name__, url_prefix='users')

@bp.route("list", methods=["POST"])
def list(report = False):

    if not flask.request.is_json:
        flask.abort(404)

    if not flask.g.isAdmin:
        flask.abort(403)

    requestData = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "page" : {"type" : "integer"},
            "size" : {"type" : "integer"},
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
                    "allOf": [
                        {
                            "if": {
                                "properties": { "type" : {"enum" : ["starts"] } }
                            },
                            "then": {
                                "properties": { "value" : {"type" : "string" } }
                            }
                        },
                        {
                            "if": {
                                "properties": { "type" : {"enum" : [">=","<="] } }
                            },
                            "then": {
                                "properties": { "value" : {"type" : "integer" } }
                            }
                        }
                    ]
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
                      .join(Users, on=(Book.login == Users.login))

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

            count = query.columns(COUNT_STAR).scalar()

            lastPage = -(-count // limit)   # round up

            offset = (requestData['page']-1)*requestData['size']
            query = query.offset(offset)

        query = query.limit(limit)

    if "sorters" in requestData:
        for i in requestData['sorters']:
            if i["field"] in columnsMap:
                query = query.order_by_extend( columnsMap[i["field"]].asc() if i["dir"] == "asc" else columnsMap[i["field"]].desc() )


    res = {
        "data":[]
    }

    if lastPage is not None:
        res["last_page"] = lastPage

    for row in query:

        d = {
            "id": row["id"],
            "user_name": row["user_name"],
            "zone_name": row["zone_name"],
            "seat_name": row["seat_name"],
            "fromTS": row["fromts"],
            "toTS": row["tots"]
        }

        if not report:

            d['rw'] = \
                (row["login"] == flask.g.login and row["zone_role"] <= ZONE_ROLE_USER) \
                or row["zone_role"] <= ZONE_ROLE_ADMIN

        else:
            d["login"] = row["login"]

        res['data'].append(d)

    return flask.jsonify(res)


@bp.route("edit", methods=["POST"])
def edit():

    return flask.abort(404)


##
# Format:
# { login: login, name: name, role: role, password: plain_text, action: "add|update|delete" }
# return array (now of length 1) of updated/created row
@bp.route("/api/editUser", methods=["POST"])
def TODO_XeditUser():

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
