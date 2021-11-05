import flask
from jsonschema import validate, ValidationError

from warp.db import *
from warp import utils
from warp.utils_tabulator import *

bp = flask.Blueprint('groups', __name__, url_prefix='groups')

membersSchema = addToTabulatorSchema({
    "properties": {
        "groupLogin": {"type": "string"},
    },
    "required": ["groupLogin"],
})

@bp.route("members", methods=["POST"])
@utils.validateJSONInput(membersSchema,isAdmin=True)
def members():

    requestData = flask.request.get_json()

    query = Groups.select(Users.login, Users.name, Users.account_type) \
                  .join(Users, on=(Groups.login == Users.login)) \
                  .where(Groups.group == requestData['groupLogin']) \
                  .tuples()

    (query, lastPage) = applyTabulatorToQuery(query,requestData)

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

assignSchema = {
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

# Format
# {
#   add: [ login1, login2, ...]
#   remove: [ login1, login2, ...]
# }
@bp.route("assign", methods=["POST"])
@utils.validateJSONInput(assignSchema,isAdmin=True)
def assign():

    action_data = flask.request.get_json()

    with DB.atomic():

        if 'remove' in action_data:

            try:

                Groups.delete() \
                      .where(Groups.group == action_data['groupLogin']) \
                      .where(Groups.login.in_(action_data['remove'])) \
                      .execute()

            except IntegrityError as err:
                return {"msg": "Error", "code": 212 }, 400


        if 'add' in action_data:

            try:
                insData = [ {"group": action_data['groupLogin'], "login": x } for x in action_data['add'] ]
                Groups.insert(insData).on_conflict_ignore().execute()

            except IntegrityError as err:
                return {"msg": "Error", "code": 213 }, 400

    return {"msg": "ok" }, 200

