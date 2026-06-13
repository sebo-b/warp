# WARP Container Files

This directory contains all container-related files for building and deploying WARP.
Both Docker and Podman are supported — substitute `docker` with `podman` in any
command below if that is your runtime.

## Directory layout

```
containers/
  Dockerfile          — production image (uWSGI, no database)
  Dockerfile_debug    — all-in-one debug/test image (Flask + PostgreSQL)
  nginx.conf          — minimal nginx reverse-proxy configuration
  compose/
    compose.yaml      — example deployment via Docker / Podman Compose
  quadlet/
    warp.pod          — Podman Quadlet: pod definition
    warp-app.build    — Podman Quadlet: build the production image
    warp-app.container — Podman Quadlet: WARP application container
    warp-nginx.container — Podman Quadlet: nginx reverse proxy container
```

---

## `Dockerfile`

**Production image.** Multi-stage build based on `python:3.13-slim`:

1. **Compile stage** — installs Node.js, builds the JavaScript bundle with webpack,
   compiles all Python dependencies into wheels, and packages WARP itself.
2. **Runtime stage** — copies only the built wheels and static assets; runs WARP via
   uWSGI on port 8000.

This image contains **no database**. In production, run PostgreSQL separately and
point `WARP_DATABASE` at it.

Build from the repository root:
```sh
docker build -f containers/Dockerfile -t warp:latest .
```

Run (replace values as needed):
```sh
docker run -d \
  --name warp \
  -p 8000:8000 \
  -e WARP_DATABASE="psycopg3://user:password@db-host:5432/warp" \
  -e WARP_SECRET_KEY="<generated-secret>" \
  warp:latest
```

uWSGI listens on port 8000. Place nginx or another reverse proxy in front of it
(see `nginx.conf` below).

---

## `Dockerfile_debug`

**Debug / end-to-end test image.** Single Alpine-based image that runs both
PostgreSQL and Flask's development server in the same container:

- PostgreSQL 18 on port 5432 — initialised with `postgres_password` as the
  superuser password.
- Flask debug server on port 5000 — resets the database to `sql/sample_data.sql`
  on every start.

**Not for production use.** This image trades isolation and security for
convenience: single container, auto-reset state, Werkzeug debugger enabled.

Used automatically by the e2e Playwright suite in `../e2e/`. You can also start
it manually for interactive debugging:

```sh
docker build -f containers/Dockerfile_debug -t warp-debug .
docker run --rm -p 5000:5000 -p 5432:5432 warp-debug
```

Then open http://127.0.0.1:5000 and log in as `admin` / `noneshallpass`.

---

## `nginx.conf`

Minimal nginx configuration that reverse-proxies HTTP traffic to the WARP uWSGI
process on port 8000. Used by both `compose/compose.yaml` (mounted automatically)
and the Quadlet deployment (copy to the host before starting the pod — see the
[Quadlet setup](#setup) section below).

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
| `POSTGRES_PASSWORD` | `postgres_password` | A strong database password (update in both services) |
| `WARP_DATABASE_POST_INIT_SCRIPTS` | loads sample data | Remove or replace with your own seed |
| `WARP_LANGUAGE_FILE` | `i18n/en.js` | Your preferred language |

For all available settings see [CONFIGURATION.md](../CONFIGURATION.md).

---

## Podman Quadlet (systemd integration)

[Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
lets Podman generate systemd services from declarative unit files. The four files
in `quadlet/` define a production deployment as a systemd-managed pod.

### Architecture

```
[ systemd ]
     │
     └─ warp.service  (pod — all containers share one network namespace)
           ├─ warp-db.service      ← PostgreSQL on :5432 (internal)
           ├─ warp-app.service     ← uWSGI on :8000 (internal)
           └─ warp-nginx.service   ← nginx on :80, published as host :8080
```

All three containers share `localhost`, so the app connects to the database at
`localhost:5432` and nginx proxies to the app at `localhost:8000`.
If you prefer an external PostgreSQL, remove `warp-db.container` and update
`WARP_DATABASE` in `warp-app.container` with the external host.

### Quadlet files

| File | Type | Role |
|---|---|---|
| `warp.pod` | `.pod` | Pod definition — networking, port publishing, restart policy |
| `warp-app.build` | `.build` | Builds the WARP image from `Dockerfile` |
| `warp-db.container` | `.container` | PostgreSQL database container |
| `warp-app.container` | `.container` | WARP application container (uWSGI) |
| `warp-nginx.container` | `.container` | nginx reverse proxy container |
| `nftables_init.sh` | shell script | Optional: pod-level firewall via nftables |

### Setup

1. **Adjust paths and secrets** in the unit files:
   - `warp-app.build` — set `File=` to the absolute path of `containers/Dockerfile`
     in your clone (e.g. `/opt/warp/containers/Dockerfile`).
   - `warp-db.container` and `warp-app.container` — replace `<db-password>` with
     the same strong password in both files.
   - `warp-app.container` — replace `<change-to-a-random-secret>` with a generated
     key. See [CONFIGURATION.md](../CONFIGURATION.md#secret-key).
   - `warp-nginx.container` — copy `containers/nginx.conf` to the host path in
     the `Volume=` line (default: `/etc/warp/nginx.conf`):
     ```sh
     sudo install -Dm644 containers/nginx.conf /etc/warp/nginx.conf
     ```

2. **Create the database directory** and set ownership to the postgres UID (999):
   ```sh
   sudo install -d -o 999 -g 999 /var/lib/warp/pgdata
   ```

3. **Copy unit files** to the Quadlet drop-in directory:
   ```sh
   # system-wide (root) — copy only the .pod, .build, and .container files
   sudo cp containers/quadlet/*.pod \
            containers/quadlet/*.build \
            containers/quadlet/*.container \
            /etc/containers/systemd/

   # or per-user (rootless Podman)
   cp containers/quadlet/*.pod \
      containers/quadlet/*.build \
      containers/quadlet/*.container \
      ~/.config/containers/systemd/
   ```

4. **Reload systemd** so it picks up the generated unit files:
   ```sh
   sudo systemctl daemon-reload        # system-wide
   systemctl --user daemon-reload      # rootless
   ```

5. **Start the pod**:
   ```sh
   sudo systemctl start warp.service
   systemctl --user start warp.service   # rootless
   ```

   On first start, `warp-app-build.service` builds the WARP image automatically.

6. **Enable on boot**:
   ```sh
   sudo systemctl enable warp.service
   ```

### Optional: pod-level firewall with nftables

`nftables_init.sh` applies firewall rules directly inside the pod's network
namespace after the pod starts. This lets you restrict which hosts can reach the
pod on port 8080 — useful when the pod is attached to a network and you want only
a trusted upstream (e.g. a load balancer) to connect.

The script uses `nsenter` to enter the network namespace owned by the pod's infra
container (`systemd-warp-infra`) and loads an nftables ruleset there, completely
separate from the host firewall.

To enable it:

```sh
# Install the script
sudo install -Dm755 containers/quadlet/nftables_init.sh /etc/warp/nftables_init.sh

# Edit /etc/warp/nftables_init.sh and set ALLOWED_HTTP_SOURCE to the IP or
# CIDR of your upstream reverse proxy, or leave it as 0.0.0.0/0 to allow all.

# Uncomment ExecStartPost= in containers/quadlet/warp.pod, then re-copy and reload:
sudo cp containers/quadlet/warp.pod /etc/containers/systemd/
sudo systemctl daemon-reload
sudo systemctl restart warp.service
```

Dependencies: `jq` and `nftables` must be installed on the host.

### Optional: networking

By default the pod uses the default Podman network. To attach it to a named
network, create a `warp.network` Quadlet file and uncomment the `Network=` line
in `warp.pod`.

For rootless deployments with custom UID/GID mappings, uncomment and adjust the
`UserNS=` line in `warp.pod` to match your `/etc/subuid` and `/etc/subgid` entries.
