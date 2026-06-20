FROM alpine:3.24 AS builder

RUN apk add nodejs npm python3 py3-pip

# WARP Python dependencies
WORKDIR /warp
COPY requirements.txt .
RUN pip wheel -w wheel -r requirements.txt \
    && rm -f wheel/lxml-*.whl wheel/xmlsec-*.whl

# webpack dependencies
WORKDIR /warp/js
COPY js/package.json js/package-lock.json js/webpack.config.js .
RUN npm ci

# build
COPY js/views/ views/
COPY js/base/ base/
RUN npm run build

# copy warp and build it as a module
WORKDIR /warp
COPY setup.py MANIFEST.in .
COPY warp/ warp/
RUN pip wheel -w wheel --no-deps .

###########################################
FROM alpine:3.24

ENV WARPAPP_UID=200
ENV WARPAPP_GID=200
ENV WARPAPP_RUN_DIR=/run/warp

RUN apk add python3 py3-pip uwsgi-python3 \
    # Alpine-native py3-lxml/py3-xmlsec share the same libxml2.so as uWSGI (no version mismatch)
    py3-lxml py3-xmlsec libxslt

RUN --mount=type=bind,from=builder,source=/warp/wheel,target=./wheel \
    pip install \
        --no-index \
        --no-deps \
        --break-system-packages \
        --no-warn-script-location \
        wheel/*.whl

COPY --chmod=755 containers/res/entrypoint.sh /entrypoint.sh

# 8000 = uWSGI binary protocol, 8080 = plain HTTP. The entrypoint also creates
# matching unix sockets in /run/warp for an in-pod reverse proxy (e.g. Caddy).
EXPOSE 8000/tcp 8080/tcp
ENTRYPOINT ["/entrypoint.sh"]
