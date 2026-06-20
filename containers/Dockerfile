FROM alpine:latest AS builder

RUN apk add nodejs npm python3 py3-pip \
    # Build dependencies for python3-saml (xmlsec / lxml native extensions)
    python3-dev build-base libxml2-dev xmlsec-dev libxslt-dev pkgconfig

# WARP Python dependencies
WORKDIR /warp
COPY requirements.txt .
RUN pip wheel -w wheel -r requirements.txt

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
FROM alpine:latest

ENV WARPAPP_UID=200
ENV WARPAPP_GID=200
ENV WARPAPP_RUN_DIR=/run/warp

RUN apk add python3 py3-pip uwsgi-python3 \
    # Runtime libraries for python3-saml
    libxml2 xmlsec libxslt

RUN --mount=type=bind,from=builder,source=/warp/wheel,target=./wheel \
    pip install \
        --no-index \
        --no-deps \
        --break-system-packages \
        --no-warn-script-location \
        wheel/*.whl

#COPY containers/res/uwsgi.ini /uwsgi.ini
COPY --chmod=755 containers/res/entrypoint.sh /entrypoint.sh

EXPOSE 8000/tcp 8080/tcp
ENTRYPOINT ["/entrypoint.sh"]
