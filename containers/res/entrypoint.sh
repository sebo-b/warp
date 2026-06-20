#!/bin/sh

addgroup -g ${WARPAPP_GID} warp
adduser -u ${WARPAPP_UID} -D -H -G warp -h / warp

install -d -o ${WARPAPP_UID} -g ${WARPAPP_GID} -m 755 ${WARPAPP_RUN_DIR}
rm -rf ${WARPAPP_RUN_DIR}/static

WARP_PKG_STATIC=$(python -c "import importlib.resources as r; print(r.files('warp') / 'static')")
cp -r "${WARP_PKG_STATIC}" ${WARPAPP_RUN_DIR}
chown -R ${WARPAPP_UID}:${WARPAPP_GID} ${WARPAPP_RUN_DIR}/static

if [ "$#" -eq 0 ]; then
    # Four endpoints are exposed so the app fits either reverse-proxy topology:
    #   - TCP  0.0.0.0:8000  uWSGI protocol  ) for an EXTERNAL reverse proxy,
    #   - TCP  0.0.0.0:8080  plain HTTP      )   published via warp.pod
    #   - unix uwsgi.sock      uWSGI protocol ) for an IN-POD proxy (Caddy) over
    #   - unix uwsgi-http.sock plain HTTP     )   the shared /run/warp volume
    /usr/sbin/uwsgi \
        --plugin=python3 \
        --uid=${WARPAPP_UID} \
        --gid=${WARPAPP_GID} \
        --socket=0.0.0.0:8000 \
        --http-socket=0.0.0.0:8080 \
        --chmod-socket=666 \
        --socket=${WARPAPP_RUN_DIR}/uwsgi.sock \
        --http-socket=${WARPAPP_RUN_DIR}/uwsgi-http.sock \
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
