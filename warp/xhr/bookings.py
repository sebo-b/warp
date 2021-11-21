import flask
import peewee
import xlsxwriter
import io
from jsonschema import validate, ValidationError

from warp.db import *
from warp import utils
from warp.utils_tabulator import *

bp = flask.Blueprint('bookings', __name__, url_prefix='bookings')

@bp.route("report", methods=["POST"])
def report():
    return listW(True)

listSchema = addToTabulatorSchema({
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "export": {"enum": ["xlsx"] },
        "filter": {    #this just extends the default tabulator schema for "function" filter
            "items": {
                "properties": {
                    "type" : {"enum" : ["function"] }
                },
                "allOf": [
                    {
                        "if": {
                            "properties": { "type" : {"enum" : ["function"] } }
                        },
                        "then": {
                            "properties": {
                                "value" : {
                                    "type" : "object",
                                    "properties": {
                                        "fromts" : {"type" : ["integer","null"]},
                                        "tots" : {"type" : ["integer","null"]}
                                    }
                                }
                            }
                        }
                    },
                ],
            },
        },
    },
})

@bp.route("list", endpoint='list', methods=["POST"])
@utils.validateJSONInput(listSchema)
def listW(report = False):      # list is a built-in type

    if not flask.g.isAdmin and report:
        flask.abort(403)

    requestData = flask.request.get_json()

    if not report and 'export' in requestData:
        flask.abort(403)

    query = Book.select(Book.id, Users.name.alias('user_name'), Users.login, Zone.name.alias('zone_name'), Seat.name.alias('seat_name'), Book.fromts, Book.tots) \
                      .join(Seat, on=(Book.sid == Seat.id)) \
                      .join(Zone, on=(Seat.zid == Zone.id)) \
                      .join(Users, on=(Book.login == Users.login))

    # user restrictions (in non-report mode)
    # visibility only on assigned zones and not in the past
    if not report:

        query = query.select_extend(UserToZoneRoles.zone_role) \
                     .join(UserToZoneRoles, on=(UserToZoneRoles.zid == Seat.zid)) \
                     .where( (UserToZoneRoles.login == flask.g.login) & (Book.fromts >= utils.today()) )

    columnsMap = {
        "id": Book.id,
        "user_name": Users.name,
        "login": Users.login,
        "zone_name": Zone.name,
        "seat_name": Seat.name,
        "fromTS": Book.fromts,
        "toTS": Book.tots
    }

    def funOperator(field,value):

        from functools import reduce
        import operator

        if not isinstance(value,dict) or field.name != 'fromts':
            return True

        expressions = []
        if 'fromTS' in value and value['fromTS'] != None:
            expressions.append( Book.fromts >= value['fromTS'])
        if 'toTS' in value and value['toTS'] != None:
            expressions.append( Book.tots <= value['toTS'])

        return reduce(operator.and_, expressions)


    (query,lastPage) = applyTabulatorToQuery(query, requestData, columnsMap, funOperator)

    if "export" in requestData:

        # this is already checked, but ...
        if not flask.g.isAdmin:
            flask.abort(403)

        # apply limit, clear offset (just in case)
        query = query.offset().limit(flask.current_app.config['MAX_REPORT_ROWS'])

        # only xlsx for now
        memoryBuffer = io.BytesIO()

        workbook = xlsxwriter.Workbook(memoryBuffer, {'in_memory': True})
        worksheet = workbook.add_worksheet()

        # TODO_TR
        columnsHeader = [ "User name", "Login", "Zone name", "Seat name", "From", "To" ]
        columnsContent = [ "user_name", "login", "zone_name", "seat_name", "fromts", "tots" ]

        worksheet.write_row(0,0,columnsHeader)

        for rowNo,dbRow in enumerate(query.iterator(),1):

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