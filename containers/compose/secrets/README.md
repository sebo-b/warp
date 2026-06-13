# Docker Compose secret files

These files provide default values for `docker compose up` out of the box.
**Replace them with strong, unique values before using in production.**

- `db_password.txt` — PostgreSQL superuser password (shared by the DB and app services)
- `secret_key.txt` — Flask session signing key (generate with `python -c 'import os; print(os.urandom(16))'`)
