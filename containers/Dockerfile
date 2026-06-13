FROM alpine:latest AS builder

RUN apk add nodejs npm python3 py3-pip

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

FROM alpine:latest

WORKDIR /warp
RUN apk add python3 py3-pip uwsgi-python3

RUN \
    --mount=type=bind,from=builder,source=/warp/wheel,target=./wheel \
    pip install --break-system-packages --no-index --no-deps wheel/*.whl

COPY --from=builder /warp/warp/static ./static
COPY containers/warp_uwsgi.ini .

EXPOSE 8000/tcp
ENTRYPOINT ["/usr/sbin/uwsgi", "warp_uwsgi.ini"]
