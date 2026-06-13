# WARP Configuration Reference

All configuration lives in `warp/config.py`. Every setting can be overridden via an
environment variable prefixed with `WARP_` (e.g. `WARP_SECRET_KEY`, `WARP_WEEKS_IN_ADVANCE`).

## How environment variables work

Environment variable values are always strings, so WARP parses them into the correct
Python type automatically. Each value is lowercased and then fed through `json.loads`.
If that fails, it is kept as a plain string. This lets you pass any Python type from
the environment:

| Python type   | Example env var value                 |
| ------------- | ------------------------------------- |
| boolean       | `"true"` / `"false"`                  |
| integer       | `"30"`                                |
| null          | `"null"`                              |
| array         | `'["sql/seed.sql", "sql/extra.sql"]'` |
| object / dict | `'{"connect_timeout": 10}'`           |

**Passing values in docker run:**

```sh
docker run --env WARP_SECRET_KEY=mysecretkey \
           --env WARP_WEEKS_IN_ADVANCE=2 \
           --env 'WARP_OMITTED_WEEKDAYS=[5, 6]' \
           warp:latest
```

**Passing values in docker compose:**

```yaml
environment:
  WARP_SECRET_KEY: mysecretkey
  WARP_WEEKS_IN_ADVANCE: "2"
  WARP_OMITTED_WEEKDAYS: "[5, 6]"
```

---

## Quick reference

| Setting                      | Default      | Required | Description                                    |
| ---------------------------- | ------------ | :------: | ---------------------------------------------- |
| `DATABASE`                   | —            | **yes**  | Database connection URL                        |
| `SECRET_KEY`                 | —            | **yes**¹ | Cookie signing key                             |
| `DATABASE_ARGS`              | `{}`         |    no    | Extra args for the psycopg3 driver             |
| `SESSION_LIFETIME`           | `1`          |    no    | Session duration in days                       |
| `LANGUAGE_FILE`              | `i18n/en.js` |    no    | UI translation file                            |
| `WEEKS_IN_ADVANCE`           | `1`          |    no    | Weeks after current week available for booking |
| `BOOK_OPEN`                  | `0`          |    no    | Earliest bookable time (seconds from midnight) |
| `BOOK_CLOSE`                 | `86400`      |    no    | Latest bookable time (seconds from midnight)   |
| `OMITTED_WEEKDAYS`           | `[]`         |    no    | Weekday numbers to hide (0=Mon … 6=Sun)        |
| `AUTOBOOK_USAGE_WINDOW_DAYS` | `30`         |    no    | Days window for auto-book seat ranking         |
| `MIN_PASSWORD_LENGTH`        | `6`          |    no    | Minimum password length                        |
| `MAX_REPORT_ROWS`            | `5000`       |    no    | Maximum rows in Excel export                   |
| `MAX_MAP_SIZE`               | `2 MB`       |    no    | Maximum zone map image size                    |
| `MAX_CONTENT_LENGTH`         | `5 MB`       |    no    | Maximum request body size                      |
| `TIMEZONE`                   | auto-detect  |    no    | Timezone label in iCal `DTSTART`/`DTEND`       |

¹ Required in production. A missing or default key is not safe.

---

## Database

### Connection URL

WARP uses the **psycopg3** driver. Connection URLs must start with `psycopg3://`:

```
WARP_DATABASE=psycopg3://user:password@hostname:5432/warp_db
```

Older schemes (`postgresql://`, `psycopg2://`) are not supported.

Optional extra driver arguments (passed verbatim to psycopg3):

```
WARP_DATABASE_ARGS='{"connect_timeout": 10, "application_name": "warp"}'
```

### Initialization scripts

These variables control what SQL WARP runs when it first creates the schema, and
whenever a force-reinit is triggered. The execution order is:
`PRE_INIT_SCRIPTS` → schema → `POST_INIT_SCRIPTS`.

| Variable                     | Type                       | Default            | Description                                                                                                                                                                                        |
| ---------------------------- | -------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PRE_INIT_SCRIPTS`  | `array` of `string`        | `[]`               | SQL files executed **before** the schema. Useful for teardown/cleanup in development.                                                                                                              |
| `DATABASE_SCHEMA`            | `string`                   | `"sql/schema.sql"` | Path to the canonical schema file. Rarely needs overriding.                                                                                                                                        |
| `DATABASE_POST_INIT_SCRIPTS` | `array` of `string`        | `[]`               | SQL files executed **after** the schema on first init (e.g. seed data).                                                                                                                            |
| `DATABASE_MIGRATION_SCRIPTS` | `array` of `(int, string)` | see `config.py`    | Ordered `(version, path)` pairs for automatic schema migrations. Any migration whose version is higher than the recorded database version is applied in order on startup. Rarely needs overriding. |

Example — load sample data on first run:

```
WARP_DATABASE_POST_INIT_SCRIPTS='["sql/sample_data.sql"]'
```

---

## Secret key

`SECRET_KEY` is used to sign session cookies. **Always set it in production** — the
default value in `config.py` is not secret.

Three equivalent ways to generate one:

```sh
# Python stdlib
python -c 'import os; print(os.urandom(16))'

# OpenSSL → escaped byte string
openssl rand -hex 16 | sed 's/\(..\)/\\x\1/g;s/^/b"/;s/$/"/'

# OpenSSL bytes via Python
python -c 'from subprocess import run; print(run(["openssl","rand","16"],capture_output=True).stdout)'
```

---

## Language

The UI language is set globally for the instance — all users see the same language.

| Language          | `LANGUAGE_FILE` value |
| ----------------- | --------------------- |
| English (default) | `i18n/en.js`          |
| German            | `i18n/de.js`          |
| French            | `i18n/fr.js`          |
| Spanish           | `i18n/es.js`          |
| Polish            | `i18n/pl.js`          |

```
WARP_LANGUAGE_FILE=i18n/de.js
```

The iCal feed and action pages use the same language file for event summaries and
button labels.

---

## Booking window

| Variable           | Default | Description                                                                                                                    |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `WEEKS_IN_ADVANCE` | `1`     | How many weeks past the current week are visible in the date picker. `0` means only the current week; `1` means next week too. |
| `BOOK_OPEN`        | `0`     | Earliest bookable time, in seconds from midnight. `0` = 00:00.                                                                 |
| `BOOK_CLOSE`       | `86400` | Latest bookable time, in seconds from midnight. `86400` = 24:00.                                                               |
| `OMITTED_WEEKDAYS` | `[]`    | List of weekday numbers to hide from the date picker. `0`=Monday, `6`=Sunday.                                                  |

Common examples:

```sh
WARP_BOOK_OPEN=32400              # 09:00 AM  (9 × 3600)
WARP_BOOK_CLOSE=64800             # 06:00 PM  (18 × 3600)
WARP_OMITTED_WEEKDAYS="[5, 6]"   # hide Saturday and Sunday
WARP_WEEKS_IN_ADVANCE=2           # two weeks of future dates
```

Per-seat booking windows (days-in-advance) are set in the zone map editor and are
independent of this system-wide window.

---

## Session

| Variable           | Default | Description                                                                                                                                                                       |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_LIFETIME` | `1`     | Number of days before a login session expires and the user must re-authenticate. Note: advancing the virtual clock in debug/test mode by more than one day also expires sessions. |

---

## Password policy

| Variable              | Default | Description                                                                                                                       |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_PASSWORD_LENGTH` | `6`     | Minimum character count enforced by the change-password form. Applies only to built-in auth; SSO users do not set WARP passwords. |

---

## Auto-book

| Variable                     | Default | Description                                                                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `AUTOBOOK_USAGE_WINDOW_DAYS` | `30`    | Number of past days considered when ranking seats by personal booking frequency for the auto-book algorithm. |

---

## Report & upload limits

| Variable             | Default | Description                                                                                                              |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `MAX_REPORT_ROWS`    | `5000`  | Maximum rows returned in one Excel export. A warning is shown in the UI when the current filter would exceed this limit. |
| `MAX_MAP_SIZE`       | `2 MB`  | Maximum size for zone map image uploads (JPEG or PNG).                                                                   |
| `MAX_CONTENT_LENGTH` | `5 MB`  | Maximum HTTP request body size enforced by Flask.                                                                        |

---

## Calendar / iCal

| Variable   | Default     | Description                                                                                                                                           |
| ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIMEZONE` | auto-detect | IANA timezone name (e.g. `Europe/Berlin`) inserted into iCal `DTSTART` and `DTEND` fields. When not set, WARP attempts to detect the server timezone. |

---

## Authentication providers

WARP ships with built-in username/password auth. Three optional SSO providers are
available; only one can be active at a time.

| Provider                | Enable with        | Notes                                                                 |
| ----------------------- | ------------------ | --------------------------------------------------------------------- |
| Built-in (default)      | —                  | Users authenticate with a login + password stored in WARP's database. |
| LDAP / Active Directory | `AUTH_LDAP=true`   | See [LDAP configuration](#ldap--active-directory).                    |
| Azure Active Directory  | `AUTH_AAD=true`    | See [Azure AD configuration](#azure-active-directory-aad).            |
| SAML 2.0                | `AUTH_MELLON=true` | See [SAML configuration](#saml-20-via-apache-mod_auth_mellon).        |

All SSO providers support:

- **Auto-provisioning**: a WARP user account is created automatically on first login.
- **Group mapping**: SSO groups can be mapped to WARP groups (see [Group mapping](#ldap-group-mapping)).
- **Excluded users**: specific logins can be kept on local password auth even when SSO is active.

---

## LDAP / Active Directory

Set `AUTH_LDAP=true` and configure at minimum `LDAP_SERVER_URL` and `LDAP_USER_TEMPLATE`.

Features:

- Plain LDAP, LDAPS (`ldaps://`), or StartTLS
- SIMPLE or NTLM bind types
- Automatic WARP account creation on first login; display name synced on every login
- Group mapping and strict group sync
- Per-login exclusions (keep specific accounts on local auth)

### Configuration variables

Please note that every variable can be set either in the config file or via the environment
(in that case, it needs to be prefixed by `WARP_`).

| variable:      | `AUTH_LDAP`                                  |
| :------------- | :------------------------------------------- |
| type:          | `boolean`                                    |
| default value: | `False`                                      |
| description:   | Set to `True` to enable LDAP authentication. |

| variable:      | `LDAP_SERVER_URL`                                                                                       |
| :------------- | :------------------------------------------------------------------------------------------------------ |
| type:          | `string`                                                                                                |
| default value: | `None` (must be defined)                                                                                |
| description:   | Server URL, either `ldap://address[:port]` or `ldaps://address[:port]`.<br/>Use `ldap://` for StartTLS. |

| variable:      | `LDAP_AUTH_TYPE`                                                                                                       |
| :------------- | :--------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`: `SIMPLE` or `NTLM`                                                                                           |
| default value: | `SIMPLE`                                                                                                               |
| description:   | LDAP bind/authentication type.<br/>For `NTLM` see [Active Directory authentication](#active-directory-authentication). |

| variable:      | `LDAP_STARTTLS`                                                          |
| :------------- | :----------------------------------------------------------------------- |
| type:          | `boolean`                                                                |
| default value: | `True`                                                                   |
| description:   | Upgrade a plain `ldap://` connection to TLS via StartTLS before binding. |

| variable:      | `LDAP_VALIDATE_CERT`                                                 |
| :------------- | :------------------------------------------------------------------- |
| type:          | `boolean`                                                            |
| default value: | `False`                                                              |
| description:   | Validate the server TLS certificate for SSL or StartTLS connections. |

| variable:      | `LDAP_TLS_VERSION`                                                                        |
| :------------- | :---------------------------------------------------------------------------------------- |
| type:          | `string`: `TLSv1`, `TLSv1.1`, or `TLSv1.2`                                                |
| default value: | `None`                                                                                    |
| description:   | Pin a specific TLS protocol version. When not set, the Python SSL module default is used. |

| variable:      | `LDAP_TLS_CIPHERS`                                                                              |
| :------------- | :---------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                        |
| default value: | `None`                                                                                          |
| description:   | Restrict TLS to the specified cipher list. When not set, the Python SSL module default is used. |

| variable:      | `LDAP_USER_TEMPLATE`                                                                                                                      |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                                                  |
| default value: | `None` (must be defined)                                                                                                                  |
| description:   | Template for the bind DN or username. Must contain a `{login}` placeholder.<br/>OpenLDAP: a full DN. Active Directory: `Domain\\{login}`. |
| example:       | OpenLDAP: `uid={login},ou=users,dc=example,dc=org`<br/>AD: `SAMDOM\{login}`                                                               |

| variable:      | `LDAP_USER_SEARCH_BASE`                                                                                                                                                                                            |
| :------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                                                                                                                           |
| default value: | `None`                                                                                                                                                                                                             |
| description:   | Search base for fetching the user's LDAP entry. Falls back to `LDAP_USER_TEMPLATE` when not set (suitable for OpenLDAP where the template is already a DN). For Active Directory, set this to the users container. |
| example:       | OpenLDAP: leave unset<br/>AD: `cn=users,dc=samdom,dc=example,dc=org`                                                                                                                                               |

| variable:      | `LDAP_USER_SEARCH_FILTER_TEMPLATE`                                                  |
| :------------- | :---------------------------------------------------------------------------------- |
| type:          | `string`                                                                            |
| default value: | `(objectClass=person)`                                                              |
| description:   | LDAP filter for the user lookup. May contain a `{login}` placeholder.               |
| example:       | OpenLDAP: `(objectClass=*)`<br/>AD: `(&(sAMAccountName={login})(objectClass=user))` |

| variable:      | `LDAP_USER_NAME_ATTRIBUTE`                              |
| :------------- | :------------------------------------------------------ |
| type:          | `string`                                                |
| default value: | `cn`                                                    |
| description:   | LDAP attribute used as the user's display name in WARP. |

| variable:      | `LDAP_GROUP_SEARCH_BASE`                                                               |
| :------------- | :------------------------------------------------------------------------------------- |
| type:          | `string`                                                                               |
| default value: | `None` (must be defined if using group mapping)                                        |
| description:   | Search base for group membership lookups.                                              |
| example:       | OpenLDAP: `ou=groups,dc=example,dc=org`<br/>AD: `CN=Users,DC=samdom,DC=example,DC=org` |

| variable:      | `LDAP_GROUP_SEARCH_FILTER_TEMPLATE`                                                                            |
| :------------- | :------------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                       |
| default value: | `(&(memberUid={login})(cn={group}))`                                                                           |
| description:   | LDAP filter for checking whether a user belongs to a group. Must contain `{login}` and `{group}` placeholders. |
| example:       | AD with `memberOf`: `(&(sAMAccountName={login})(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:={group}))` |

| variable:      | `LDAP_GROUP_MAP`                                                                |
| :------------- | :------------------------------------------------------------------------------ |
| type:          | `array` of `[string\|null, string\|null]` pairs                                 |
| default value: | `[ [null, null] ]`                                                              |
| description:   | Maps LDAP groups to WARP groups. See [LDAP group mapping](#ldap-group-mapping). |

| variable:      | `LDAP_GROUP_STRICT_MAPPING`                                                                           |
| :------------- | :---------------------------------------------------------------------------------------------------- |
| type:          | `boolean`                                                                                             |
| default value: | `False`                                                                                               |
| description:   | When `True`, removes the user from any WARP group that is not matched by the group map on each login. |

| variable:      | `LDAP_EXCLUDED_USERS`                                                                                                                        |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `array` of `string`                                                                                                                          |
| default value: | `[]`                                                                                                                                         |
| description:   | Logins that always authenticate against WARP's local password database, even when LDAP is enabled. Useful for keeping a local admin account. |

### LDAP group mapping

`LDAP_GROUP_MAP` is an array of `[ldap_group, warp_group]` pairs. It controls two things simultaneously:

1. **Access control**: which LDAP group memberships are required to log in.
2. **Role sync**: which WARP groups to add the user to based on their LDAP groups.

The four patterns, from most restrictive to most open:

**1 — Restrict login to specific LDAP groups (no WARP group sync):**

```json
[
  ["LDAP group 1", null],
  ["LDAP group 2", null]
]
```

A user must be a member of at least one listed group to log in. No WARP groups are assigned.

**2 — Restrict login and sync WARP groups:**

```json
[
  ["LDAP group 1", "WARP group A"],
  ["LDAP group 2", "WARP group B"]
]
```

Only members of `LDAP group 1` or `LDAP group 2` can log in. On login, the user is added to the corresponding WARP group(s).

**3 — Restrict login to one group, always add to WARP groups:**

```json
[
  ["LDAP group 1", null],
  [null, "WARP group A"],
  [null, "WARP group B"]
]
```

Only members of `LDAP group 1` can log in. Every user who logs in is added to `WARP group A` and `WARP group B`.

**4 — Allow all LDAP users, optionally sync groups:**

```json
[
  [null, null],
  ["LDAP group 1", "WARP group A"],
  ["LDAP group 2", "WARP group B"]
]
```

The `[null, null]` entry disables the login restriction — every valid LDAP user can log in. Group sync still applies for members of the listed groups.

Notes:

- A user must satisfy at least one entry with a non-null LDAP group (or a `[null, null]` entry must be present) to be allowed in.
- WARP groups are not created automatically — they must exist before the mapping runs.
- When `LDAP_GROUP_STRICT_MAPPING=true`, any WARP group not matched by the map is removed from the user on login.

### Active Directory authentication

Active Directory usually authenticates with `Domain\Username` instead of a DN.
Use `NTLM` auth type and set the following (example values):

```sh
WARP_LDAP_AUTH_TYPE=NTLM
WARP_LDAP_USER_TEMPLATE="SAMDOM\\{login}"
WARP_LDAP_USER_SEARCH_BASE="cn=Users,dc=samdom,dc=example,dc=org"
WARP_LDAP_USER_SEARCH_FILTER_TEMPLATE="(&(sAMAccountName={login})(objectClass=user))"
```

Note the double backslash: most shells and config files treat `\` as an escape character,
so the domain separator must be written as `\\`.

This applies to both `SIMPLE` and `NTLM` auth types when using AD.

### `memberOf` attribute and `LDAP_MATCHING_RULE_IN_CHAIN`

When using the `memberOf` attribute for group membership, configure the search like this:

```sh
WARP_LDAP_GROUP_SEARCH_BASE="CN=Users,DC=samdom,DC=example,DC=org"
WARP_LDAP_GROUP_SEARCH_FILTER_TEMPLATE="(&(sAMAccountName={login})(objectClass=user)(memberOf={group}))"
```

If your server supports `LDAP_MATCHING_RULE_IN_CHAIN` (transitive group membership):

```sh
WARP_LDAP_GROUP_SEARCH_BASE="CN=Users,DC=samdom,DC=example,DC=org"
WARP_LDAP_GROUP_SEARCH_FILTER_TEMPLATE="(&(sAMAccountName={login})(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:={group}))"
```

### Example configurations

#### OpenLDAP

```sh
WARP_AUTH_LDAP="true"
WARP_LDAP_SERVER_URL="ldap://ldap.example.org:1389"
WARP_LDAP_USER_TEMPLATE="uid={login},ou=users,dc=example,dc=org"
WARP_LDAP_GROUP_SEARCH_BASE="ou=groups,dc=example,dc=org"
WARP_LDAP_GROUP_MAP="[ ['WARP_allowed', null], [null, 'Everyone'] ]"
WARP_LDAP_EXCLUDED_USERS="['admin']"

# The following are defaults — shown here for clarity
WARP_LDAP_STARTTLS="true"
WARP_LDAP_VALIDATE_CERT="false"
WARP_LDAP_USER_NAME_ATTRIBUTE="cn"
WARP_LDAP_GROUP_SEARCH_FILTER_TEMPLATE="(&(memberUid={login})(cn={group}))"
```

#### Active Directory

```sh
WARP_AUTH_LDAP="true"
WARP_LDAP_SERVER_URL="ldaps://ldap.example.org:636"
WARP_LDAP_VALIDATE_CERT="true"
WARP_LDAP_AUTH_TYPE="NTLM"
WARP_LDAP_USER_TEMPLATE="SAMDOM\\{login}"
WARP_LDAP_USER_SEARCH_BASE="cn=Users,dc=samdom,dc=example,dc=org"
WARP_LDAP_USER_SEARCH_FILTER_TEMPLATE="(&(sAMAccountName={login})(objectClass=user))"
WARP_LDAP_GROUP_SEARCH_BASE="CN=Users,DC=samdom,DC=example,DC=org"
WARP_LDAP_GROUP_SEARCH_FILTER_TEMPLATE="(&(sAMAccountName={login})(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:={group}))"
WARP_LDAP_EXCLUDED_USERS="['admin']"
WARP_LDAP_GROUP_MAP="[ ['CN=warp_allowed,CN=Users,DC=samdom,DC=example,DC=com', 'AD users'], [null, 'Everyone'] ]"
```

### Importing users manually

Users can be added one by one from the admin UI, or imported directly into the database.
Insert rows into the `user` table (see `warp/sql/schema.sql` for the schema).

Account type values:

| Value | Role         |
| ----- | ------------ |
| `10`  | Admin        |
| `20`  | Regular user |
| `90`  | Blocked      |

Passwords are hashed with `werkzeug.security.generate_password_hash` (pbkdf2:sha256,
16-byte salt, 260 000 iterations by default). Generate a hash:

```sh
python -c 'from getpass import getpass; from werkzeug.security import generate_password_hash; print(generate_password_hash(getpass()))'
```

---

## Azure Active Directory (AAD)

Set `AUTH_AAD=true` and configure `AAD_TENANT`, `AAD_CLIENT_ID`, and `AAD_CLIENT_SECRET`.
Users are redirected to Microsoft's OAuth2 / OIDC login flow.

Features: auto-provisioning, display name sync on every login, same group mapping model as LDAP.

### Configuration variables

| variable:      | `AUTH_AAD`                                       |
| :------------- | :----------------------------------------------- |
| type:          | `boolean`                                        |
| default value: | `False`                                          |
| description:   | Set to `True` to enable Azure AD authentication. |

| variable:      | `AAD_TENANT`                                                                  |
| :------------- | :---------------------------------------------------------------------------- |
| type:          | `string`                                                                      |
| default value: | `None` (must be defined)                                                      |
| description:   | Azure AD tenant ID (a UUID visible in the Azure portal under "Directory ID"). |

| variable:      | `AAD_CLIENT_ID`                |
| :------------- | :----------------------------- |
| type:          | `string`                       |
| default value: | `None` (must be defined)       |
| description:   | Azure application (client) ID. |

| variable:      | `AAD_CLIENT_SECRET`                                          |
| :------------- | :----------------------------------------------------------- |
| type:          | `string`                                                     |
| default value: | `None` (must be defined)                                     |
| description:   | Azure application client secret. Treat this like a password. |

| variable:      | `AAD_HTTPS_SCHEME`                                                                                                                                                   |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`: `https` or `http`                                                                                                                                          |
| default value: | `https`                                                                                                                                                              |
| description:   | Scheme used when constructing the OAuth2 redirect URI sent to Azure. Change to `http` only in local development (Azure requires HTTPS for production redirect URIs). |

| variable:      | `AAD_USER_NAME_ATTRIBUTE`                           |
| :------------- | :-------------------------------------------------- |
| type:          | `string`                                            |
| default value: | `name`                                              |
| description:   | OIDC claim used as the user's display name in WARP. |

| variable:      | `AAD_LOGIN_ATTRIBUTE`                                                                                                    |
| :------------- | :----------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                                 |
| default value: | `preferred_username`                                                                                                     |
| description:   | OIDC claim used as the WARP login (username). Change to `email` if `preferred_username` is not populated in your tenant. |

| variable:      | `AAD_GROUP_MAP`                                                                                                |
| :------------- | :------------------------------------------------------------------------------------------------------------- |
| type:          | `array` of `[string\|null, string\|null]` pairs                                                                |
| default value: | `[ [null, null] ]`                                                                                             |
| description:   | Maps Azure AD group object IDs to WARP group names. Same semantics as [`LDAP_GROUP_MAP`](#ldap-group-mapping). |

| variable:      | `AAD_GROUP_STRICT_MAPPING`                                                                                                             |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `boolean`                                                                                                                              |
| default value: | `False`                                                                                                                                |
| description:   | When `True`, removes WARP group memberships not matched by the group map on each login. Same semantics as `LDAP_GROUP_STRICT_MAPPING`. |

---

## SAML 2.0 via Apache mod_auth_mellon

WARP supports SAML 2.0 via the Apache [mod_auth_mellon](https://github.com/latchset/mod_auth_mellon)
module. Authentication and logout are handled entirely by the Apache reverse proxy; WARP reads
the attributes set by Mellon in the request environment.

Set `AUTH_MELLON=true` and deploy Apache with mod_auth_mellon in front of WARP. Mellon must pass
at least `MELLON_uid` (used as the WARP login) and `MELLON_cn` (used as the display name).

Features: auto-provisioning on first login, optional default WARP group for all SAML users,
logout redirected through the Mellon endpoint.

### Configuration variables

| variable:      | `AUTH_MELLON`                                                        |
| :------------- | :------------------------------------------------------------------- |
| type:          | `boolean`                                                            |
| default value: | `False`                                                              |
| description:   | Set to `True` to enable SAML 2.0 authentication via mod_auth_mellon. |

| variable:      | `MELLON_ENDPOINT`                                                                                               |
| :------------- | :-------------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                        |
| default value: | `None` (must be defined)                                                                                        |
| description:   | The Mellon endpoint path configured on the Apache proxy, e.g. `/sp`. Used to construct the logout redirect URL. |

| variable:      | `MELLON_DEFAULT_GROUP`                                                                                                                                                                                 |
| :------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                                                                                                               |
| default value: | `None`                                                                                                                                                                                                 |
| description:   | Name of an existing WARP group that every SAML-provisioned user is automatically added to on first login. Useful for granting zone access to all SSO users without configuring individual assignments. |

### Notes

- SAML-provisioned users have their WARP password set to `*` (unusable), preventing local login.
- There is no per-user group mapping for Mellon — all users get `MELLON_DEFAULT_GROUP` if set.
- Logging out calls the Mellon logout endpoint at `<MELLON_ENDPOINT>/logout`, which in turn
  performs the SAML single-logout flow with the identity provider.
