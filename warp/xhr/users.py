import flask
from jsonschema import validate, ValidationError
import orjson

from warp.db import *
from warp import utils

bp = flask.Blueprint('users', __name__, url_prefix='users')

@bp.route("list", endpoint='list', methods=["POST"])
def listW(report = False):              #list is a built-in type

    if not flask.request.is_json:
        return {"msg": "Non-JSON request", "code": 160 }, 404

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 161 }, 403

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
                        "type" : {"enum" : ["starts", "=", "!=", "<", ">="] }
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
                                "properties": { "type" : {"enum" : ["=","!=","<"] } }
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
        return {"msg": "Data error", "code": 162 }, 400

    columnsMap = {
        "login": Users.login,
        "name": Users.name,
        "account_type": Users.account_type,
    }

    import operator
    operatorsMap = {
        "=": operator.__eq__,
        "!=": operator.__ne__,
        "<": operator.__lt__,
        ">=": operator.__ge__,
        'starts': lambda field,value: field.startswith(value)
    }

    query = Users.select(Users.login, Users.name, Users.account_type).tuples()

    if "filters" in requestData:
        for i in requestData['filters']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] in operatorsMap:

                    value = i["value"]
                    op = operatorsMap[i['type']]

                    # for some reason sometimes (when dropdown is shown) tabulator ssends it as array
                    if isinstance(value,list):
                        value = value[0]

                    query = query.where( op(field,i["value"]) )

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

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')

# Format:
# { login: login, name: name, account_type: account_type, password: plain_text, action: "add|update" }
@bp.route("edit", methods=["POST"])
def edit():

    from werkzeug.security import generate_password_hash

    if not flask.request.is_json:
        return {"msg": "Non-JSON request", "code": 150 }, 404

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 151 }, 403

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "login" : {"type" : "string"},
            "name" : {"type" : "string"},
            "account_type" : {"enum" : [ACCOUNT_TYPE_ADMIN,ACCOUNT_TYPE_USER,ACCOUNT_TYPE_BLOCKED,ACCOUNT_TYPE_GROUP]},
            "password" : {"type" : "string"},
            "action": {"enum": ["add","update"]}
        },
        "required": [ "login", "action", "name", "account_type"]
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "Data error", "code": 152 }, 400

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():

            updColumns = {
                Users.name: action_data['name'],
                Users.account_type: action_data['account_type'],
            }

            if len(action_data.get('password','')) > 0 and action_data['account_type'] < ACCOUNT_TYPE_GROUP:
                updColumns[Users.password] = generate_password_hash(action_data['password'])

            if action_data['action'] == "update":

                updateQ = Users.update(updColumns) \
                                .where(Users.login == action_data['login'])

                # prevent conversion from User <=> Group
                if updColumns[ Users.account_type ] < ACCOUNT_TYPE_GROUP:
                    updateQ = updateQ.where( Users.account_type < ACCOUNT_TYPE_GROUP)
                else:
                    updateQ = updateQ.where( Users.account_type >= ACCOUNT_TYPE_GROUP)

                rowCount = updateQ.execute()

                if rowCount != 1:
                    raise ApplyError("Wrong number of affected rows", 153)

            elif action_data['action'] == "add":

                updColumns[Users.login] = action_data['login'],
                from time import perf_counter_ns
                t1 = perf_counter_ns()
                Users.insert(updColumns).execute()
                t2 = perf_counter_ns()
                print(f'>>>> Users.insert {(t2-t1)/1e6}')

    except IntegrityError as err:
        if action_data['action'] == "add":
            return {"msg": "Login exits", "code": 155 }, 400
        else:
            return {"msg": "Error", "code": 156 }, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok", "code": 157 }, 200


# Format:
# { login: login, force: true|false }
@bp.route("delete", methods=["POST"])
def delete():

    if not flask.request.is_json:
        return {"msg": "Non-JSON request", "code": 170 }, 404

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 171 }, 403

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "login" : {"type" : "string"},
            "force": {"type": "boolean"}
        },
        "required": [ "login" ]
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "Data error", "code": 172 }, 400

    login = action_data['login']
    force = action_data.get('force', False)

    if not force:
        today = utils.today()

        rowCount = Book.select(COUNT_STAR) \
                       .where(Book.login == login) \
                       .where(Book.fromts < today) \
                       .scalar()

        if rowCount:
            return {"msg": "User has past bookings", "bookCount": rowCount, "code": 173}, 406

    try:
        with DB.atomic():

            # rowCount ?
            Users.delete().where(Users.login == login) \
                 .execute()

    except IntegrityError:
        return {"msg": "Error", "code":  174}, 400


    return {"msg": "ok", "code": 175 }, 200

