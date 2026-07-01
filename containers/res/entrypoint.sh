#!/bin/sh

addgroup -g ${WARPAPP_GID} warp
adduser -u ${WARPAPP_UID} -D -H -G warp -h / warp

install -d -o ${WARPAPP_UID} -g ${WARPAPP_GID} -m 755 ${WARPAPP_RUN_DIR}
rm -rf ${WARPAPP_RUN_DIR}/static

WARP_PKG_STATIC=$(python -c "import importlib.resources as r; print(r.files('warp') / 'static')")
cp -r "${WARP_PKG_STATIC}" ${WARPAPP_RUN_DIR}
chown -R ${WARPAPP_UID}:${WARPAPP_GID} ${WARPAPP_RUN_DIR}/static

if [ "$#" -eq 0 ]; then

    : ${WARPAPP_UWSGI_SOCKET=${WARPAPP_RUN_DIR}/uwsgi.sock}
    : ${WARPAPP_UWSGI_HTTP_SOCKET=${WARPAPP_RUN_DIR}/uwsgi-http.sock}
    set --
    [ -n "${WARPAPP_UWSGI_SOCKET}" ] && set -- "$@" --socket="${WARPAPP_UWSGI_SOCKET}"
    [ -n "${WARPAPP_UWSGI_HTTP_SOCKET}" ] && set -- "$@" --http-socket="${WARPAPP_UWSGI_HTTP_SOCKET}"

    exec /usr/sbin/uwsgi \
        --plugin=python3 \
        --uid=${WARPAPP_UID} \
        --gid=${WARPAPP_GID} \
        --chmod-socket=666 \
        "$@" \
        --master \
        --log-master \
        --buffer-size=32768 \
        --processes=4 \
        --threads=2 \
        --offload-threads=2 \
        --mimefile=/etc/mime.types \
        --die-on-term \
        --module='warp:create_app()' \
        --static-map=/static=${WARPAPP_RUN_DIR}/static
else
    exec "$@"
fi
