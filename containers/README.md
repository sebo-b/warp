# WARP Container Files

This directory contains all container-related files for building and deploying WARP.
Both Docker and Podman are supported — substitute `docker` with `podman` in any
command below if that is your runtime.

## Directory layout

```
containers/
  Dockerfile          — production image (uWSGI, no database)
  Dockerfile_debug    — all-in-one debug/test image (Flask + PostgreSQL)
  nginx.conf          — minimal nginx config used by the compose demo
  res/
    entrypoint.sh     — production image entrypoint (starts uWSGI)
    Caddyfile         — Caddy reverse-proxy config (static files + unix socket)
  compose/
    compose.yaml      — example deployment via Docker / Podman Compose
  quadlet/
    warp.pod                — Podman Quadlet: pod definition (network, ports)
    warp-shared.volume      — shared tmpfs volume (unix sockets + static files)
    warp-db.container       — PostgreSQL database container
    warp-app.container      — WARP application container (uWSGI)
    warp-revproxy.container — Caddy reverse proxy container
    nftables_init.sh        — optional pod-level firewall script
```

---

## `Dockerfile`

**Production image.** Runs WARP via uWSGI on port 8000. Contains **no database** —
run PostgreSQL separately and configure the connection via `WARP_DATABASE_ADDRESS`,
`WARP_DATABASE_NAME`, `WARP_DATABASE_USER`, and `WARP_DATABASE_PASSWORD`.

Build from the repository root:
```sh
docker build -f containers/Dockerfile -t warp:latest .
```

Run (replace values as needed):
```sh
docker run -d \
  --name warp \
  -p 8000:8000 \
  -e WARP_DATABASE_ADDRESS="db-host:5432" \
  -e WARP_DATABASE_NAME=warp \
  -e WARP_DATABASE_USER=user \
  -e WARP_DATABASE_PASSWORD=password \
  -e WARP_SECRET_KEY="<generated-secret>" \
  warp:latest
```

uWSGI listens on port 8000. Place nginx or another reverse proxy in front of it
(see `nginx.conf` below).

---

## `Dockerfile_debug`

**Debug / end-to-end test image.** Single Alpine-based image that runs both
PostgreSQL and Flask's development server in the same container:

- PostgreSQL 18 — initialised with `postgres_password` as the superuser
  password. Listens on **localhost inside the container only** by default.
- Flask debug server on port 5000 — resets the database to `sql/sample_data.sql`
  on every start.

> **Not for production use.** This image trades isolation and security for
> convenience: a single container, auto-reset state, the Werkzeug debugger, a
> hard-coded Postgres password, `fsync=off`, and the `/debug/*` blueprint with
> its authentication bypass all enabled. The published `ghcr.io/<owner>/warp:debug`
> tag exists purely for e2e/interactive debugging — deploy `warp:latest` (or a
> versioned tag) instead.

Used automatically by the e2e Playwright suite in `../e2e/`. You can also start
it manually for interactive debugging:

```sh
docker build -f containers/Dockerfile_debug -t warp-debug .
docker run --rm -p 5000:5000 warp-debug
```

Then open http://127.0.0.1:5000 and log in as `admin` / `noneshallpass`.

**Reaching PostgreSQL from the host.** By default the database is bound to the
container's loopback interface, so `-p 5432:5432` alone will *not* expose it
(the proxy connects to the container IP, which Postgres is not listening on). To
inspect the database from the host, set `EXPOSE_POSTGRES=1` so Postgres binds all
interfaces, and publish the port:

```sh
docker run --rm -p 5000:5000 -p 5432:5432 -e EXPOSE_POSTGRES=1 warp-debug
# then: psql "postgresql://postgres:postgres_password@127.0.0.1:5432/postgres"
```

---

## `nginx.conf`

Minimal nginx configuration that reverse-proxies traffic to the WARP uWSGI
process over the uWSGI protocol on port 8000. Used only by the
`compose/compose.yaml` demo (mounted automatically). The Quadlet deployment uses
Caddy instead — see [`res/Caddyfile`](#rescaddyfile) and the
[Podman Quadlet](#podman-quadlet-systemd-integration) section.

---

## `res/Caddyfile`

Reverse-proxy configuration for the Caddy container used by the Quadlet
deployment. It serves WARP's static assets directly from the shared `/run/warp`
volume and forwards every other request to the app over the
`/run/warp/uwsgi-http.sock` unix socket. By default it listens on plain HTTP
(`auto_https off`); to let Caddy manage TLS certificates, set a real domain as
the site address and remove `auto_https off`.

---

## `compose/compose.yaml`

**Example production-style deployment** using Docker / Podman Compose. Brings up
three services:

| Service | Image | Role |
|---|---|---|
| `warp-demo-db` | `postgres` (official) | PostgreSQL database |
| `warp-demo-wsgi` | built from `Dockerfile` | WARP application (uWSGI) |
| `warp-demo-nginx` | `nginx` (official) | Reverse proxy, port 8080 |

**Quick start** (from the `compose/` directory):
```sh
cd containers/compose
docker compose up
```

Open http://127.0.0.1:8080 and log in as `admin` / `noneshallpass`.

**Before using in production**, change at minimum:

| Variable | Current value | What to set |
|---|---|---|
| `WARP_SECRET_KEY` | `mysecretkey` | A random secret — see [CONFIGURATION.md](../CONFIGURATION.md#secret-key) |
| `POSTGRES_PASSWORD` | `postgres_password` (via shared secret) | A strong database password (set once in the secret file, used by both services) |
| `WARP_DATABASE_POST_INIT_SCRIPTS` | loads sample data | Remove or replace with your own seed |
| `WARP_LANGUAGE_FILE` | `i18n/en.js` | Your preferred language |

For all available settings see [CONFIGURATION.md](../CONFIGURATION.md).

---

## Podman Quadlet (systemd integration)

[Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
lets Podman generate systemd services from declarative unit files. The files in
`quadlet/` define a production deployment as a systemd-managed pod. This is the
recommended production setup.

### Architecture

```
[ systemd ]
     │
     └─ warp-pod.service   (pod — shared network ns + shared /run/warp volume)
           ├─ warp-db.service        ← PostgreSQL on localhost:5432 (in-pod)
           ├─ warp-app.service       ← uWSGI: unix sockets in /run/warp,
           │                            plus TCP 8000 (uWSGI) / 8080 (HTTP)
           └─ warp-revproxy.service  ← Caddy on :80 (+ :443), published to host
```

All containers share `localhost`, so the app connects to the database at
`localhost:5432`. The app and Caddy also share the `warp-shared` tmpfs volume
mounted at `/run/warp`: the app exposes its HTTP socket
(`/run/warp/uwsgi-http.sock`) and copies its static assets there on start, and
Caddy reads both from the same volume. Only Caddy's ports (80/443) are published
to the host.

**Reverse proxy is optional.** If you run a reverse proxy on a *separate* host,
you can drop the Caddy container entirely and publish one of the app's own TCP
endpoints instead — `8080` for a plain-HTTP upstream or `8000` for one that
speaks the uWSGI protocol. See the commented `PublishPort` lines in `warp.pod`;
remove `warp-revproxy.container` (and its `warp-shared.volume`) in that case.

If you prefer an **external PostgreSQL**, remove `warp-db.container` and update
`WARP_DATABASE_ADDRESS` (and `WARP_DATABASE_NAME`/`WARP_DATABASE_USER`/password)
in `warp-app.container` with the external host.

### Quadlet files

| File | Type | Role |
|---|---|---|
| `warp.pod` | `.pod` | Pod definition — networking, port publishing, UserNS, restart policy |
| `warp-shared.volume` | `.volume` | Shared tmpfs at `/run/warp` (unix sockets + static files) |
| `warp-db.container` | `.container` | PostgreSQL database container |
| `warp-app.container` | `.container` | WARP application container (uWSGI) |
| `warp-revproxy.container` | `.container` | Caddy reverse proxy container |
| `nftables_init.sh` | shell script | Optional: pod-level firewall via nftables |

### Setup

The examples below use system-wide (root) Podman. For rootless, drop `sudo` and
install the unit files under `~/.config/containers/systemd/` instead.

1. **Build the application image** (until a published image is available, see the
   note in `warp-app.container`). From the repository root:
   ```sh
   sudo podman build -f containers/Dockerfile -t warp:latest .
   ```

2. **Create the podman secrets**:
   ```sh
   # Database password (used by both the DB and the app containers)
   printf '%s' 'a-strong-db-password' | sudo podman secret create warp-db-password -
   # Flask cookie-signing key
   python -c 'import os; print(os.urandom(16))' | sudo podman secret create warp-secret-key -
   ```

3. **Create the host directories.** With the default `UserNS=auto` mapping in
   `warp.pod` (base `100000`), container UIDs are shifted by `100000` on the host.
   ```sh
   # PostgreSQL data — owned by the in-container postgres user (999 → host 100999)
   sudo install -d -o 100999 -g 100999 /srv/warp/postgresql

   # Caddy config dir + the Caddyfile, and its certificate/data store.
   # Caddy runs as root in the container (0 → host 100000).
   sudo install -d -o 100000 -g 100000 /srv/caddy /srv/caddy_data
   sudo install -m644 containers/res/Caddyfile /srv/caddy/Caddyfile
   ```
   > Without `UserNS`, use the unshifted IDs instead (`999` and `0`).
   > The `/data` mount is important: Caddy stores issued TLS certificates there,
   > and a non-persistent path would re-request them on every start and quickly
   > hit rate limits.

4. **Review the unit files** and adjust paths if you changed any of the
   directories above (`Volume=` lines in `warp-db.container` and
   `warp-revproxy.container`), the image reference in `warp-app.container`, and
   `WARP_LANGUAGE_FILE` (`i18n/en.json`, also `de`/`fr`/`es`/`pl`).

5. **Install the unit files** into the Quadlet drop-in directory and reload:
   ```sh
   sudo cp containers/quadlet/*.pod \
            containers/quadlet/*.volume \
            containers/quadlet/*.container \
            /etc/containers/systemd/
   sudo systemctl daemon-reload
   ```
   (You can also symlink them from a checkout so updates track the repository.)

6. **Start the pod** and enable it on boot:
   ```sh
   sudo systemctl start warp-pod.service
   sudo systemctl enable warp-pod.service
   ```

   Check status with `podman pod ps` and `podman logs warp-app`.

### Optional: pod-level firewall with nftables

`nftables_init.sh` applies firewall rules directly inside the pod's network
namespace after the pod starts. This lets you restrict which hosts can reach the
published ports — useful when you want only a trusted upstream (e.g. a load
balancer) to connect directly to the pod.

The script uses `nsenter` to enter the network namespace owned by the pod's infra
container and loads an nftables ruleset there, completely separate from the host
firewall. It locates that container via the pod-id-file passed as `%t/%N.pod-id`
(the same kind of ID file Quadlet uses for Caddy's reload), so it keeps working
regardless of how the pod or its containers are named.

To enable it:

```sh
# Install the script
sudo install -Dm755 containers/quadlet/nftables_init.sh /srv/warp/nftables_init.sh

# Edit /srv/warp/nftables_init.sh and set ALLOWED_HTTP_SOURCE to the IP or CIDR
# of your upstream reverse proxy (or leave 0.0.0.0/0 to allow all). HTTP_PORTS
# defaults to "80 443"; set it to the app port (8080/8000) if you publish those.

# Uncomment ExecStartPost= in containers/quadlet/warp.pod, then re-copy and reload:
sudo cp containers/quadlet/warp.pod /etc/containers/systemd/
sudo systemctl daemon-reload
sudo systemctl restart warp-pod.service
```

Dependencies: `nftables` and `nsenter` (from `util-linux`) must be installed on
the host.

### Optional: networking and user namespaces

By default the pod uses the default Podman network. To attach it to a named
network, create a `warp.network` Quadlet file and uncomment the `Network=` line
in `warp.pod`.

The `UserNS=auto:...` line in `warp.pod` maps container UIDs into an unprivileged
host range (base `100000`). Adjust it to match your `/etc/subuid` and
`/etc/subgid` entries, and remember to shift host directory ownership
accordingly (see step 3).
