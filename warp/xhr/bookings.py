import flask
import peewee
import xlsxwriter
import io
from jsonschema import validate, ValidationError

from warp.db import *
from warp import utils

bp = flask.Blueprint('bookings', __name__, url_prefix='bookings')

@bp.route("report", methods=["POST"])
def report():
    return listW(True)

@bp.route("list", endpoint='list', methods=["POST"])
def listW(report = False):      # list is a built-in type

    if not flask.request.is_json:
        flask.abort(404)

    if not flask.g.isAdmin and report:
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
                        "type" : {"enum" : ["starts", ">=","<=", "function"] }
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
                        },
                        {
                            "if": {
                                "properties": { "type" : {"enum" : ["function"] } }
                            },
                            "then": {
                                "properties": {
                                    "value" : {
                                        "type" : "object",
                                        "properties": {
                                            "fromTS" : {"type" : ["integer","null"]},
                                            "toTS" : {"type" : ["integer","null"]}
                                        }
                                    }
                                }
                            }
                        },
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

    if not report and 'export' in requestData:
        flask.abort(403)

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
                elif i['type'] == 'function' and i['field'] == "fromTS":
                    if 'fromTS' in i['value'] and i['value']['fromTS'] != None:
                        query = query.where( Book.fromts >= i["value"]['fromTS'])
                    if 'toTS' in i['value'] and i['value']['toTS'] != None:
                        query = query.where( Book.tots <= i["value"]['toTS'])

    # user restrictions (in non-report mode)
    # visibility only on assigned zones and not in the past
    if not report:

        query = query.select_extend(UserToZoneRoles.zone_role) \
                     .join(UserToZoneRoles, on=(UserToZoneRoles.zid == Seat.zid)) \
                     .where( (UserToZoneRoles.login == flask.g.login) & (Book.fromts >= utils.today()) )


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


    if "export" in requestData:

        # this is already checked, but ...
        if not flask.g.isAdmin:
            flask.abort(403)

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