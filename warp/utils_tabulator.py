import operator
import peewee

__all__ = ['addToTabulatorSchema','applyTabulatorToQuery','tabulatorSchema']

tabulatorSchema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "page" : {"type" : "integer"},
        "size" : {"type" : "integer"},
        "sort": {
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
        "filter": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field" : {"type" : "string"},
                    "type" : {"enum" : ["starts", "=", "!=", "<", "<=", ">", ">="] }
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
                            "properties": { "type" : {"enum" : ["=", "!=", "<", "<=", ">", ">="] } }
                        },
                        "then": {
                            "properties": { "value" : {"type" : ["string","integer","array"] } }
                        }
                    },
                    {
                        "if": {
                            "properties": { "value" : {"type" : "array"} }
                        },
                        "then": {
                            "properties": {
                                "value" : {
                                    "items": {"type": ["integer","null"]},
                                },
                            }
                        }
                    }
                ]
            },
        },
    },
    "dependentRequired": {
        "page": ["size"]
    }
}

# it merges jsonSchema with default tabulator schema
# but it is very dumb (dicts are added to dicts, lists to lists)
# so if you are not carefull the output schema may basically be wrong
def addToTabulatorSchema(jsonSchema):

    import collections.abc
    from functools import reduce
    import copy

    def mergeSchemas(a, b):
        for k in b:
            if k not in a:
                a[k] = b[k]
            else:
                if isinstance(a[k], dict) and isinstance(b[k], dict):
                    mergeSchemas(a[k],b[k])
                elif isinstance(a[k], list) and isinstance(b[k], list):

                    hashable = reduce(lambda a,b: a and isinstance(b,collections.abc.Hashable), a[k]+b[k], True)
                    if hashable:
                        tmpSet = set(a[k])
                        tmpSet.update(b[k])
                        a[k] = list(tmpSet)
                    else:
                        a[k] += b[k]
                elif a[k] == b[k]:
                    pass
                else:
                    raise Exception('Different types in merged schemas, key='+k)

    schema = copy.deepcopy(tabulatorSchema)
    mergeSchemas(schema,jsonSchema)

    return schema

# returns (query,lastPage)
#
# functionOperator is used for 'function' comparison
# it is def fo(field,value) -> peewee.Expression
def applyTabulatorToQuery(query,requestJSON,columnsMap = None,functionOperator = None):

    def getColName(c):
        if isinstance(c,peewee.Alias):
            return c._alias
        if isinstance(c,peewee.Column):
            return c.name
        raise Exception('Wrong type, please provide columnMap')

    if columnsMap is None:
        # _returning is private, but it seems there is no public method to read it
        columnsMap = { getColName(i): i for i in query._returning }
    elif isinstance(columnsMap,list):
        columnsMap = { getColName(i): i for i in columnsMap }

    operatorsMap = {
        "=": operator.__eq__,
        "!=": operator.__ne__,
        "<": operator.__lt__,
        "<=": operator.__le__,
        ">": operator.__gt__,
        ">=": operator.__ge__,
        'starts': lambda field,value: field.startswith(value)
    }

    if functionOperator is not None:
        operatorsMap['function'] = functionOperator

    if "filter" in requestJSON:
        for i in requestJSON['filter']:
            if i["field"] in columnsMap:
                field = columnsMap[i["field"]]
                if i['type'] in operatorsMap:

                    value = i["value"]
                    op = operatorsMap[i['type']]

                    # for some reason sometimes (when dropdown is shown) tabulator sends it as array
                    if isinstance(value,list):
                        value = value[0]

                    query = query.where( op(field,i["value"]) )

    lastPage = None
    if "size" in requestJSON:

        limit = requestJSON['size']

        if "page" in requestJSON:

            count = query.count()
            lastPage = -(-count // limit)   # round up

            offset = (requestJSON['page']-1)*requestJSON['size']
            query = query.offset(offset)

        query = query.limit(limit)

    if "sort" in requestJSON:
        for i in requestJSON['sort']:
            if i["field"] in columnsMap:
                query = query.order_by_extend( columnsMap[i["field"]].asc() if i["dir"] == "asc" else columnsMap[i["field"]].desc() )

    return (query,lastPage)
