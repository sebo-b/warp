import flask
from jsonschema import validate, ValidationError

from warp import auth
from warp.db import *

bp = flask.Blueprint('users', __name__, url_prefix='users')

@bp.route("list", endpoint='list', methods=["POST"])
def listW(report = False):              #list is a built-in type

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
                        "type" : {"enum" : ["starts", "="] }
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
                                "properties": { "type" : {"enum" : ["="] } }
                            },
                            "then": {
                                "properties": { "value" : {"type" : ["integer","array"] } }
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
        "login": Users.login,
        "name": Users.name,
        "account_type": Users.account_type,
    }

    query = Users.select(Users.login, Users.name, Users.account_type) \
                 .where(Users.account_type < ACCOUNT_TYPE_GROUP) \
                 .tuples()

    if "filters" in requestData:
        for i in requestData['filters']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] == '=':

                    # for some reason sometimes (when dropdown is shown) tabulator ssends it as array
                    if isinstance(i['value'],list):
                        query = query.where( field == i["value"][0])
                    else:
                        query = query.where( field == i["value"])

                elif i['type'] == 'starts':
                    query = query.where( field.startswith(i["value"]))

    lastPage = None
    if "size" in requestData:

        limit = requestData['size']

        if "page" in requestData:

            count = query.columns(COUNT_STAR).scalar() #TODO_X

            lastPage = -(-count // limit)   # round up

            offset = (requestData['page']-1)*requestData['size']
            query = query.offset(offset)

        query = query.limit(limit)

    if "sorters" in requestData:
        for i in requestData['sorters']:
            if i["field"] in columnsMap:
                query = query.order_by_extend( columnsMap[i["field"]].asc() if i["dir"] == "asc" else columnsMap[i["field"]].desc() )


    res = {
        "data": [
            {
                "login": d[0],
                "name": d[1],
                "account_type": d[2]
            } for d in query.iterator()
         ]
    }

    if lastPage is not None:
        res["last_page"] = lastPage

    return flask.jsonify(res)

# Format:
# { login: login, name: name, role: role, password: plain_text, action: "add|update|delete" }
@bp.route("edit", methods=["POST"])
def edit():

    from werkzeug.security import generate_password_hash

    if not flask.request.is_json:
        flask.abort(404)

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 150 }, 403

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "login" : {"type" : "string"},
            "name" : {"type" : "string"},
            "account_type" : {"enum" : [ACCOUNT_TYPE_ADMIN,ACCOUNT_TYPE_USER,ACCOUNT_TYPE_BLOCKED]},
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
                    "required": [ "name", "account_type" ]
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
        return {"msg": "Data error", "code": 151 }, 400

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():

            passHash = None
            if 'password' in action_data and len(action_data['password']) > 0:
                passHash = generate_password_hash(action_data['password'])

            if action_data['action'] == "update":

                updColumns = {
                    Users.name: action_data['name'],
                    Users.account_type: action_data['account_type'],
                }

                if passHash:
                    updColumns[Users.password] = passHash

                rowCount = Users.update(updColumns) \
                                .where(Users.login == action_data['login']) \
                                .where(Users.account_type <= ACCOUNT_TYPE_GROUP) \
                                .execute()

                if rowCount != 1:
                    raise ApplyError("Wrong number of affected rows", 152)

            elif action_data['action'] == "add":

                if passHash is None:
                    raise ApplyError("Password cannot be empty", 153)

                Users.insert({
                    Users.login: action_data['login'],
                    Users.name: action_data['name'],
                    Users.account_type: action_data['account_type'],
                    Users.password: passHash
                }).execute()

            elif action_data['action'] == "delete":

                login = action_data['login']

                if login == flask.g.login:
                    raise ApplyError("You cannot delete yourself", 154)

                Groups.delete().where(Groups.login == login).execute()
                ZoneAssign.delete().where(ZoneAssign.login == login).execute()
                SeatAssign.delete().where(SeatAssign.login == login).execute()
                rowCount = Users.delete() \
                                .where(Users.login == login) \
                                .where(Users.account_type <= ACCOUNT_TYPE_GROUP) \
                                .execute()

                if rowCount != 1:
                    raise ApplyError("Wrong number of affected rows", 155)

    except IntegrityError as err:
        if action_data['action'] == "delete":
            return {"msg": "User cannot be deleted", "code": 156 }, 400
        elif action_data['action'] == "add":
            return {"msg": "Login exits", "code": 157 }, 400
        else:
            return {"msg": "Error", "code": 158 }, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok", "code": 159 }, 200
