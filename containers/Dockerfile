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
# Sane default; operators override via compose/quadlet environment: TZ=Europe/Warsaw
ENV TZ=UTC

RUN apk add python3 py3-pip uwsgi-python3 \
    # tzdata is required by Python zoneinfo (and localtime()) on musl/Alpine
    tzdata \
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

ENTRYPOINT ["/entrypoint.sh"]
