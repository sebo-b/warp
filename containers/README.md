# WARP Container Files

This directory contains all container-related files for building and deploying WARP.
Both Docker and Podman are supported — substitute `docker` with `podman` in any command
below if that is your runtime.

---

## Files

### `Dockerfile`

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

uWSGI listens on port 8000. Place an Nginx or other reverse proxy in front of it
(see `../res/nginx.conf` for a minimal example).

---

### `Dockerfile_debug`

**Debug / end-to-end test image.** Single Alpine-based image that runs both
PostgreSQL and Flask's development server in the same container:

- PostgreSQL 18 on port 5432 — initialised with `postgres_password` as the superuser
  password.
- Flask debug server on port 5000 — resets the database to `sql/sample_data.sql` on
  every start.

**Not for production use.** This image trades isolation and security for convenience:
everything in one container, auto-reset state, Werkzeug debugger enabled.

Used automatically by the e2e Playwright suite in `../e2e/`. You can also start it
manually for interactive debugging:

```sh
# build
docker build -f containers/Dockerfile_debug -t warp-debug .

# run
docker run --rm -p 5000:5000 -p 5432:5432 warp-debug
```

Then open http://127.0.0.1:5000 and log in as `admin` / `noneshallpass`.

---

### `compose.yaml`

**Example production-style deployment** using Docker Compose. Brings up three
services:

| Service | Image | Role |
|---|---|---|
| `warp-demo-db` | `postgres` (official) | PostgreSQL database |
| `warp-demo-wsgi` | built from `Dockerfile` | WARP application (uWSGI) |
| `warp-demo-nginx` | `nginx` (official) | Reverse proxy, port 8080 |

**Quick start** (from this directory):
```sh
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
