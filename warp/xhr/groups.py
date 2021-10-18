import flask
from jsonschema import validate, ValidationError

from warp.db import *
from warp import utils

bp = flask.Blueprint('groups', __name__, url_prefix='groups')

@bp.route("members", methods=["POST"])
def members():

    if not flask.request.is_json:
        return {"msg": "Non-JSON request", "code": 200 }, 404

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 201 }, 403

    requestData = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "groupLogin": {"type": "string"},
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
                        "type" : {"enum" : ["starts"] },
                        "value" : {"type" : "string" }
                    },
                    "required": [ "field", "type", "value"],
                },
            },
        },
        "required": ["groupLogin"],
        "dependencies": {
            "page": ["size"]
        },
    }

    try:
        validate(requestData,schema)
    except ValidationError as err:
        return {"msg": "Data error", "code": 202 }, 400

    columnsMap = {
        "login": Users.login,
        "name": Users.name
    }

    query = Groups.select(Users.login, Users.name, Users.account_type) \
                  .join(Users, on=(Groups.login == Users.login)) \
                  .where(Groups.group == requestData['groupLogin']) \
                  .tuples()

    if "filters" in requestData:
        for i in requestData['filters']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] == 'starts':
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
                "isGroup": d[2] >= ACCOUNT_TYPE_GROUP
            } for d in query.iterator()
         ]
    }

    if lastPage is not None:
        res["last_page"] = lastPage

    return flask.jsonify(res)


# Format
# {
#   add: [ login1, login2, ...]
#   remove: [ login1, login2, ...]
# }
@bp.route("manage", methods=["POST"])
def manage():

    if not flask.request.is_json:
        return {"msg": "Non-JSON request", "code": 210 }, 404

    if not flask.g.isAdmin:
        return {"msg": "Forbidden", "code": 211 }, 403

    action_data = flask.request.get_json()

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "groupLogin": {"type": "string"},
            "add" : {
                "type" : "array",
                "items": { "type": "string" },
                },
            "remove" : {
                "type" : "array",
                "items": { "type": "string" },
                },
        },
        "required": ["groupLogin"],
        "anyOf": [
            {"required": ["add"]},
            {"required": ["remove"]}
        ]
    }

    try:
        validate(action_data,schema)
    except ValidationError as err:
        return {"msg": "Data error", "code": 212 }, 400

    try:

        with DB.atomic():

            if 'remove' in action_data:

                Groups.delete() \
                      .where(Groups.group == action_data['groupLogin']) \
                      .where(Groups.login.in_(action_data['remove'])) \
                      .execute()

            if 'add' in action_data:

                insData = [ {"group": action_data['groupLogin'], "login": x } for x in action_data['add'] ]
                from time import perf_counter_ns
                t1 = perf_counter_ns()
                Groups.insert(insData).on_conflict_ignore().execute()
                t2 = perf_counter_ns()
                print(f'>>>> Groups.insert {(t2-t1)/1e6}')

    except IntegrityError as err:
        return {"msg": "Error", "code": 213 }, 400

    return {"msg": "ok", "code": 214 }, 200

