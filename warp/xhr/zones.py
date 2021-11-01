import flask
from peewee import JOIN, fn, EXCLUDED

from warp.db import *
from warp import utils

bp = flask.Blueprint('zones', __name__, url_prefix='zones')

listSchema = {
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
                    "type" : {"enum" : ["starts","="] },
                    "value": {"type" : "string"},
                },
                "required": [ "field", "type", "value"],
            },
        },
    },
    "dependencies": {
        "page": ["size"]
    }
}

@bp.route("list", endpoint='list', methods=["POST"])
@utils.validateJSONInput(listSchema,isAdmin=True)
def listW(report = False):              #list is a built-in type

    requestData = flask.request.get_json()

    columnsMap = {
        "name": Zone.name,
        "zone_group": Zone.zone_group,
    }

    import operator
    operatorsMap = {
        "=": lambda field,value:  field == int(value),    # tabulator pass it as string
        'starts': lambda field,value: field.startswith(value)
    }

    countQuery = UserToZoneRoles.select( \
            UserToZoneRoles.zid, \
            COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_ADMIN).alias("admins"), \
            COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_USER).alias("users"), \
            COUNT_STAR.filter(UserToZoneRoles.zone_role == ZONE_ROLE_VIEWER).alias("viewers")) \
        .group_by(UserToZoneRoles.zid)
    query = Zone.select(Zone.id, Zone.name, Zone.zone_group,
                        fn.COALESCE(countQuery.c.admins,0).alias('admins'),
                        fn.COALESCE(countQuery.c.users,0).alias('users'),
                        fn.COALESCE(countQuery.c.viewers,0).alias('viewers')) \
                .join(countQuery, join_type=JOIN.LEFT_OUTER, on=(Zone.id == countQuery.c.zid))

    if "filters" in requestData:
        for i in requestData['filters']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] in operatorsMap:

                    value = i["value"]
                    op = operatorsMap[i['type']]

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

    res = { "data": [ *query.iterator() ] }

    if lastPage is not None:
        res["last_page"] = lastPage

    return res, 200



deleteSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id" : {"type" : "integer"},
    },
    "required": [ "id" ]
}

# Format:
# { id: id }
@bp.route("delete", methods=["POST"])
@utils.validateJSONInput(deleteSchema,isAdmin=True)
def delete():

    jsonData = flask.request.get_json()
    id = jsonData['id']

    try:
        with DB.atomic():

            Zone.delete().where(Zone.id == id).execute()

    except IntegrityError:
        return {"msg": "Error", "code":  220}, 400

    return {"msg": "ok" }, 200

addOrEditSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "id" : {"type" : "integer"},
        "name" : {"type" : "string"},
        "zone_group" : {"type" : "integer"},
    },
    "required": ["name", "zone_group"]
}

# Format:
# { id: 1, (optional, if missing a new group will be created)
#   name: "name",
#   zone_group: 1
@bp.route("addoredit", methods=["POST"])
@utils.validateJSONInput(addOrEditSchema,isAdmin=True)
def addOrEdit():

    jsonData = flask.request.get_json()

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():

            updColumns = {
                Zone.name: jsonData['name'],
                Zone.zone_group: jsonData['zone_group'],
            }

            if 'id' in jsonData:

                rowCount = Zone.update(updColumns).where(Zone.id == jsonData['id']).execute()
                if rowCount != 1:
                    raise ApplyError("Wrong number of affected rows", 221)

            else:

                Zone.insert(updColumns).execute()


    except IntegrityError as err:
        return {"msg": "Error", "code": 222 }, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok" }, 200

membersSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "zid": {"type": "integer"},
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
    "required": ["zid"],
    "dependencies": {
        "page": ["size"]
    },
}

@bp.route("members", methods=["POST"])
@utils.validateJSONInput(membersSchema,isAdmin=True)
def members():

    requestData = flask.request.get_json()

    zid = requestData['zid']

    columnsMap = {
        "login": Users.login,
        "name": Users.name,
        "zone_role": ZoneAssign.zone_role,
    }

    query = ZoneAssign.select(Users.login, Users.name, ZoneAssign.zone_role, (Users.account_type >= ACCOUNT_TYPE_GROUP).alias("isGroup") ) \
                  .join(Users, on=(ZoneAssign.login == Users.login)) \
                  .where(ZoneAssign.zid == zid)

    import operator
    operatorsMap = {
        "=": operator.__eq__,
        "!=": operator.__ne__,
        "<": operator.__lt__,
        ">=": operator.__ge__,
        'starts': lambda field,value: field.startswith(value)
    }

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

    res = { "data": [ *query.iterator() ] }

    if lastPage is not None:
        res["last_page"] = lastPage

    return res

assignSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "zid": {"type": "integer"},
        "change": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "login" : {"type" : "string"},
                    "role" : {"enum" : [ZONE_ROLE_ADMIN,ZONE_ROLE_USER,ZONE_ROLE_VIEWER]}
                },
                "required": [ "login", "role"],
            },
        },
        "remove": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string" },
        },
    },
    "required": ['zid']
}

@bp.route("assign", methods=["POST"])
@utils.validateJSONInput(assignSchema,isAdmin=True)
def assign():

    jsonData = flask.request.get_json()

    class ApplyError(Exception):
        pass

    try:
        with DB.atomic():

            zid = jsonData['zid']

            if 'change' in jsonData:

                data = [
                    {
                        "zid": zid,
                        "login": i['login'],
                        "zone_role": i['role']
                    } for i in jsonData['change'] ]

                rowCount = ZoneAssign.insert(data) \
                                .on_conflict(
                                    conflict_target=[ZoneAssign.zid,ZoneAssign.login],
                                    update={ZoneAssign.zone_role: EXCLUDED.zone_role} ) \
                                .execute()

                if rowCount != len(jsonData['change']):
                    raise ApplyError("Wrong number of affected rows", 223)

            if 'remove' in jsonData:

                rowCount = ZoneAssign.delete() \
                                    .where( (ZoneAssign.zid == zid) & (ZoneAssign.login.in_(jsonData['remove'])) ) \
                                    .execute()

                if rowCount != len(jsonData['remove']):
                    raise ApplyError("Wrong number of affected rows", 224)


    except IntegrityError as err:
        return {"msg": "Error", "code": 225 }, 400
    except ApplyError as err:
        return {"msg": "Error", "code": err.args[1] }, 400

    return {"msg": "ok" }, 200
