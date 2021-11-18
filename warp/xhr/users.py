import flask
from jsonschema import validate, ValidationError
import orjson

from warp.db import *
from warp import utils
from warp.utils_tabulator import *

bp = flask.Blueprint('users', __name__, url_prefix='users')

@bp.route("list", endpoint='list', methods=["POST"])
@utils.validateJSONInput(tabulatorSchema,isAdmin=True)
def listW(report = False):              #list is a built-in type

    requestData = flask.request.get_json()

    query = Users.select(Users.login, Users.name, Users.account_type)

    (query, lastPage) = applyTabulatorToQuery(query,requestData)

    res = {
        "data": [ *query.iterator() ]
    }

    if lastPage is not None:
        res["last_page"] = lastPage

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')

editSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "login" : {"type" : "string"},
        "name" : {"type" : "string"},
        "account_type" : {"enum" : [ACCOUNT_TYPE_ADMIN,ACCOUNT_TYPE_USER,ACCOUNT_TYPE_BLOCKED,ACCOUNT_TYPE_GROUP]},
        "password" : {"type" : "string"},
        "action": {"enum": ["add","update"]},
        "groups": {
            "type": "array",
            "items": {
                "type": "string"
            },
        }
    },
    "required": [ "login", "action", "name", "account_type"]
}

# Format:
# { login: login, name: name, account_type: account_type, password: plain_text, action: "add|update" }
@bp.route("edit", methods=["POST"])
@utils.validateJSONInput(editSchema,isAdmin=True)
def edit():

    from werkzeug.security import generate_password_hash

    action_data = flask.request.get_json()

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
                Users.insert(updColumns).execute()

            if 'groups' in action_data:

                Groups.delete() \
                    .where(Groups.login == action_data['login']) \
                    .execute()

                gr = [{
                        Groups.login: action_data['login'],
                        Groups.group: i
                    } for i in action_data['groups']
                ]

                if len(gr):
                    Groups.insert(gr) \
                        .on_conflict_ignore() \
                        .execute()

    except IntegrityError as err:
        if action_data['action'] == "add":
            return {"msg": "Login exits", "code": 155 }, 400
        else:
            return {"msg": "Error", "code": 156 }, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok" }, 200


deleteSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "login" : {"type" : "string"},
        "force": {"type": "boolean"}
    },
    "required": [ "login" ]
}

# Format:
# { login: login, force: true|false }
@bp.route("delete", methods=["POST"])
@utils.validateJSONInput(deleteSchema,isAdmin=True)
def delete():

    action_data = flask.request.get_json()

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

    return {"msg": "ok" }, 200


@bp.route("groups/<login>")
def groups(login):

    if not flask.g.isAdmin:
        return {"msg":"Forbidden", "code": 175}, 403

    query = Groups.select(Users.login, Users.name) \
        .join(Users, on=(Groups.group == Users.login)) \
        .where(Groups.login == login)

    res = [ *query.iterator() ]

    return flask.current_app.response_class(
        response=orjson.dumps(res),
        status=200,
        mimetype='application/json')


