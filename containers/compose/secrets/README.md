# Docker Compose secret files

These files provide default values for `docker compose up` out of the box.
**Replace them with strong, unique values before using in production.**

- `db_password.txt` — PostgreSQL superuser password (shared by the DB and app services)
- `secret_key.txt` — Flask session signing key (generate with `python -c 'import os; print(os.urandom(16))'`)
- `oidc_client_secret.txt` (optional) — OAuth2 client secret for OIDC authentication; only needed when `WARP_AUTH_OIDC=true`
- `saml_sp_private_key.txt` (optional) — SAML SP private key for native SAML authentication; only needed when `WARP_AUTH_SAML=true`
