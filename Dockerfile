FROM python:3-slim AS compile-image

ENV NODE_VER=16.3.0

WORKDIR /opt/warp
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget mime-support build-essential libpq-dev libpcre3-dev

RUN NODE_ARCH=$(uname -m | sed 's/^x86_64\|amd64$/x64/;s/^i.*86$/x86/;s/^aarch64$/arm64/') && \
    NODE_URL="https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${NODE_ARCH}.tar.gz" && \
    wget -O - "$NODE_URL" | tar -xz --strip-components=1 -C /usr/

RUN pip install --upgrade setuptools && pip install wheel uwsgi
RUN pip wheel -w wheel/ uwsgi

WORKDIR /opt/warp/js/
# fist we install webpack dependencies as it takes the longest time
COPY js/package.json js/package-lock.json ./
RUN npm ci

# the we compile webpack as it also takes some long time
COPY js/ ./
RUN npm run build

# then warp dependencies
WORKDIR /opt/warp
COPY requirements.txt ./
RUN pip wheel -w wheel -r requirements.txt

# build warp
COPY warp ./warp
COPY setup.py MANIFEST.in ./
RUN python setup.py bdist_wheel -d wheel

FROM python:3-slim
WORKDIR /opt/warp

RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 mime-support libpcre3 && \
    rm  -rf /var/lib/apt/lists/*

RUN \
    --mount=type=bind,from=compile-image,source=/opt/warp/wheel,target=./wheel \
    pip install --no-index wheel/*.whl
#COPY --from=compile-image /opt/warp/wheel ./wheel
#RUN pip install --no-index wheel/*.whl

COPY --from=compile-image /opt/warp/warp/static ./static
COPY res/warp_uwsgi.ini .

EXPOSE 8000/tcp
ENTRYPOINT ["uwsgi", "warp_uwsgi.ini"]

