import io

import flask
from flask.wrappers import Response
from warp.db import *

def deleteBlob(blobId = None, blobIdQuery = None):

    if blobId is not None:
        query = Blobs.delete() \
                     .where(Blobs.id == blobId)
    elif blobIdQuery is not None:
        query = Blobs.delete() \
                     .where(Blobs.id.in_(blobIdQuery))
    else:
        return 0

    with DB.atomic():

        rowCount = query.execute()

    return rowCount


def addOrUpdateBlob(mimeType, data, blobId = None):

    with DB.atomic():

        if blobId is not None:

            rowCount = Blobs.update({
                            Blobs.mimetype: mimeType,
                            Blobs.data: data,
                            Blobs.etag: Blobs.etag + 1
                        }).where(Blobs.id == blobId).execute()

            if rowCount != 1:
                return None

        else:

            insertCursor = Blobs.insert({
                                Blobs.mimetype: mimeType,
                                Blobs.data: data,
                                Blobs.etag: 1
                                }) \
                            .returning(Blobs.id) \
                            .execute()

            blobId = insertCursor[0]['id']

    return blobId



def createBlobResponse(blobId = None, blobIdQuery = None):

    if blobId is not None:
        query = Blobs.select() \
                     .where(Blobs.id == blobId)
    elif blobIdQuery is not None:
        query = Blobs.select() \
                     .where(Blobs.id.in_(blobIdQuery))
    else:
        flask.abort(400)

    blobEtag = query.columns(Blobs.etag).scalar()
    if blobEtag is None:
        flask.abort(404)
    blobEtag = str(blobEtag)

    r304 = Response()
    r304.add_etag(blobEtag)
    r304.make_conditional(flask.request)

    if r304.status_code != 200:
        return r304

    row = query.columns(Blobs.data, Blobs.mimetype).scalar(as_tuple = True)

    if row is None:
        flask.abort(404)

    resp = flask.send_file(
        io.BytesIO(row[0]),
        mimetype=row[1],
        etag=blobEtag)

    resp.cache_control.no_cache = True
    resp.cache_control.private = True

    return resp


