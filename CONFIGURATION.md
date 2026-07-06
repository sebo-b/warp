# WARP Configuration Reference

All configuration lives in `warp/config.py`. Every setting can be overridden via an
environment variable prefixed with `WARP_` (e.g. `WARP_SECRET_KEY`, `WARP_WEEKS_IN_ADVANCE`).

## How environment variables work

Environment variable values are always strings; WARP parses each one according to
the **type of the setting it maps to**. The type comes from the setting, not from
guessing the value — so a string setting such as a numeric-looking password is never
coerced to an integer.

| Setting type   | Accepted env value                                              |
| -------------- | -------------------------------------------------------------- |
| string         | used verbatim (e.g. `WARP_DATABASE_PASSWORD=s3cret`)           |
| integer        | `"30"`                                                         |
| boolean        | `true` / `false` (also `yes`/`no`, `on`/`off`, `1`/`0`)        |
| array / object | JSON, e.g. `'["sql/seed.sql"]'` or `'{"connect_timeout": 10}'` |

An unrecognised `WARP_` variable is ignored with a warning; a value that does not
match its setting's type aborts startup with an error naming the variable.

**Passing values in docker run:**

```sh
docker run --env WARP_SECRET_KEY=mysecretkey \
           --env WARP_DATABASE_ADDRESS=db-host:5432 \
           --env WARP_DATABASE_NAME=warp \
           --env WARP_DATABASE_USER=user \
           --env WARP_DATABASE_PASSWORD=password \
           --env WARP_WEEKS_IN_ADVANCE=2 \
           --env 'WARP_OMITTED_WEEKDAYS=[5, 6]' \
           warp:latest
```

**Passing values in docker compose:**

```yaml
environment:
  WARP_SECRET_KEY: mysecretkey
  WARP_DATABASE_ADDRESS: "db-host:5432"
  WARP_DATABASE_NAME: warp
  WARP_DATABASE_USER: user
  WARP_DATABASE_PASSWORD: password
  WARP_WEEKS_IN_ADVANCE: "2"
  WARP_OMITTED_WEEKDAYS: "[5, 6]"
```

---

## Quick reference

| Setting                      | Default      | Required | Description                                    |
| ---------------------------- | ------------ | :------: | ---------------------------------------------- |
| `DATABASE_ADDRESS`           | —            | **yes**  | `host` or `host:port` (port defaults to 5432)  |
| `DATABASE_NAME`              | —            | **yes**  | Database name                                  |
| `DATABASE_USER`              | —            | **yes**  | Database username                              |
| `DATABASE_PASSWORD`          | —            | **yes**  | Database password                              |
| `SECRET_KEY`                 | —            | **yes**¹ | Cookie signing key                             |
| `DATABASE_ARGS`              | `{}`         |    no    | Extra args for the psycopg3 driver             |
| `SESSION_LIFETIME`           | `1`          |    no    | Session duration in days                       |
| `LANGUAGES`                  | `["en","de","fr","es","pl"]` |    no    | Locale codes offered in the picker (ships all five; narrow via this list) |
| `DEFAULT_LANGUAGE`           | `en`         |    no    | Fallback language (NULL user pref + no cookie). Must be listed in `LANGUAGES` |
| `THEME_FILE`                 | `theme.css`  |    no    | Colour theme stylesheet (`static/`-relative name, or absolute path/URL) |
| `BASE_PATH`                  | *(empty)*    |    no    | URL prefix WARP is mounted under, e.g. `/warp` (see [Mounting under a URL prefix](#mounting-under-a-url-prefix)) |
| `WEEKS_IN_ADVANCE`           | `1`          |    no    | Weeks after current week available for booking |
| `BOOK_OPEN`                  | `0`          |    no    | Earliest bookable time (seconds from midnight) |
| `BOOK_CLOSE`                 | `86400`      |    no    | Latest bookable time (seconds from midnight)   |
| `OMITTED_WEEKDAYS`           | `[]`         |    no    | Weekday numbers to grey out (0=Mon … 6=Sun)    |
| `WEEK_START_DAY`             | `0`          |    no    | First column of the booking calendar (0=Mon … 6=Sun) |
| `AUTOBOOK_USAGE_WINDOW_DAYS` | `30`         |    no    | Days window for auto-book seat ranking         |
| `MIN_PASSWORD_LENGTH`        | `6`          |    no    | Minimum password length                        |
| `LOGIN_IGNORECASE`           | `true`       |    no    | Match logins case-insensitively (all backends) |
| `MAX_REPORT_ROWS`            | `5000`       |    no    | Maximum rows in Excel export                   |
| `MAX_MAP_SIZE`               | `2 MB`       |    no    | Maximum plan image size                        |
| `MAX_CONTENT_LENGTH`         | `5 MB`       |    no    | Maximum request body size                      |

¹ Required in production. A missing or default key is not safe.

---

## Database

### Connection settings

WARP uses the **psycopg3** driver. Connection is configured via discrete
component settings rather than a URL — this avoids URL-encoding pitfalls with
passwords containing special characters.

| Setting              | Required | Description                                           |
| -------------------- | :------: | ----------------------------------------------------- |
| `DATABASE_ADDRESS`   | **yes**  | `host` or `host:port`; port defaults to `5432`        |
| `DATABASE_NAME`      | **yes**  | Database name                                         |
| `DATABASE_USER`      | **yes**  | Database username                                     |
| `DATABASE_PASSWORD`  | **yes**  | Database password                                     |

Optional extra driver arguments (passed verbatim to psycopg3):

```
WARP_DATABASE_ARGS='{"connect_timeout": 10, "application_name": "warp"}'
```

### Initialization scripts

These variables control what SQL WARP runs when it first creates the schema.
The execution order is: `PRE_INIT_SCRIPTS` → schema → `POST_INIT_SCRIPTS`.

The schema path (`sql/schema.sql`) and migration registry are internal to
`warp/db.py` and are not configurable.

| Variable                     | Type                | Default | Description                                                                                                              |
| ---------------------------- | ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_PRE_INIT_SCRIPTS`  | `array` of `string` | `[]`    | SQL files executed **before** the schema. Useful for teardown/cleanup in development.                                    |
| `DATABASE_POST_INIT_SCRIPTS` | `array` of `string` | `[]`   | SQL files executed **after** the schema on first init (e.g. seed data).                                                  |

Example — load sample data on first run:

```
WARP_DATABASE_POST_INIT_SCRIPTS='["sql/sample_data.sql"]'
```

### Secrets / `_FILE` convention

The two secrets — the database password and the secret key — can be read from a
file instead of an environment variable by appending `_FILE` to the variable
name. This suits Docker/Compose and Podman secrets:

| Variable                      | Sets the value of   |
| ----------------------------- | ------------------- |
| `WARP_DATABASE_PASSWORD_FILE` | `DATABASE_PASSWORD` |
| `WARP_SECRET_KEY_FILE`        | `SECRET_KEY`        |

```
WARP_DATABASE_PASSWORD_FILE=/run/secrets/db_password
WARP_SECRET_KEY_FILE=/run/secrets/secret_key
```

The file contents (with one trailing newline stripped) become the value. `_FILE`
is **not** a generic suffix — only the two variables above support it. Do not set
both `WARP_<KEY>` and `WARP_<KEY>_FILE` for the same key; the result depends on
environment order and is intentionally undefined.

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

The UI language is a **per-user** choice: a language picker on the login
screen and in **Preferences** lets each user pick their own, stored in
`user_prefs.language` and carried across login/logout by the `warp_lang`
cookie. A deployment configures which languages are offered and the fallback:

| Setting             | Default      | Meaning |
| ------------------- | ------------ | ------- |
| `WARP_LANGUAGES`    | `["en","de","fr","es","pl"]` | JSON array of locale codes offered in the picker (ships all five). Renders only when more than one is listed. |
| `WARP_DEFAULT_LANGUAGE` | `en`     | Fallback language for users with no pref and no cookie. Must be listed in `WARP_LANGUAGES`. |

```
WARP_LANGUAGES='["en","de","pl"]'
WARP_DEFAULT_LANGUAGE=en
```

Resolution precedence: **logged-in** users — `user_prefs.language` → `warp_lang`
cookie → `DEFAULT_LANGUAGE` (a stale cookie left by another user on a shared
device does not override your pref). **Login screen** (not logged in) —
`warp_lang` cookie → `DEFAULT_LANGUAGE`. Preferences lists each offered language
by name; there is no `Default` entry — a user with no stored preference follows
`DEFAULT_LANGUAGE` (shown applied, not selectable), so a later `DEFAULT_LANGUAGE`
change still reaches them. Picking any language pins it.

> **Breaking change:** the former `WARP_LANGUAGE_FILE` (single deployment-wide
> file) is removed. If still set, it is **silently ignored** (a startup warning
> on stderr only) and the UI falls back to `DEFAULT_LANGUAGE` (`en`). Migrate by
> setting `WARP_LANGUAGES` (a JSON array) and `WARP_DEFAULT_LANGUAGE` instead.

The iCal feed and action pages render in the owner's resolved language (a NULL
pref falls back to `DEFAULT_LANGUAGE`).

---

## Theme / branding

All WARP colours come from a single stylesheet of `--warp-*` custom properties
(`warp/static/theme.css`) — it defines the brand palette, the derived tints, the
semantic roles, and the light/dark variants. Nothing structural lives there, so it
can be swapped with zero risk of breaking layout.

| Setting      | Default     | Description                                          |
| ------------ | ----------- | ---------------------------------------------------- |
| `THEME_FILE` | `theme.css` | Theme stylesheet. A bare name is resolved relative to the `static/` folder (mount-prefix aware); an absolute path or full URL is used verbatim. |

To re-skin WARP without rebuilding the frontend bundle, mount a replacement CSS
file into the `static/` folder and point `WARP_THEME_FILE` at it:

```
WARP_THEME_FILE=mybrand.css
```

The value may also be an absolute path or full URL, emitted into the page as-is —
useful behind a reverse proxy serving the theme from outside warp's `static/`
directory (e.g. a mounted volume or CDN), with no route rewrite:

```
WARP_THEME_FILE=/branding/theme.css
WARP_THEME_FILE=https://cdn.example.org/warp/theme.css
```

The file is loaded after the base bundle, so it only needs to redefine the
`--warp-*` tokens it wants to change (e.g. `--warp-primary`, `--warp-secondary`,
`--warp-nav-bg`). See the comments in `warp/static/theme.css` for the full token
list and which roles drive what.

---

## Mounting under a URL prefix

| Variable         | Default   | Description                                        |
| ---------------- | --------- | -------------------------------------------------- |
| `WARP_BASE_PATH` | *(empty)* | URL prefix WARP is mounted under, e.g. `/warp`     |

By default WARP runs at the root of its host. To serve it under a sub-path
(e.g. `https://intranet.example.org/warp/`), set:

```bash
WARP_BASE_PATH=/warp
```

Leading/trailing slashes are normalized (`warp`, `/warp` and `/warp/` are
equivalent). The prefix is applied as WSGI `SCRIPT_NAME`, so every URL WARP
generates — views, `/xhr/*`, static assets, login redirects, the PWA manifest
scope/start_url and service-worker scope — is rebased automatically.

Two things must be configured *outside* WARP to match:

1. **The reverse proxy** must forward requests **with the prefix intact**
   (WARP strips it itself); do not rewrite the path. If the proxy serves
   `/static/*` directly from disk (as the bundled Caddyfile does), that
   matcher must become `<BASE_PATH>/static/*` — see the comments in
   `containers/res/Caddyfile`. The proxy site block and `WARP_BASE_PATH`
   must agree, or requests route to the wrong path.
2. **External auth registrations**: OIDC/SAML redirect/consumer URIs are
   registered at the IdP as absolute URLs and must include the prefix (e.g.
   `https://…/warp/oidc/callback`, SAML SP endpoints under
   `<BASE_PATH>/saml`). A prefix change without updating the IdP breaks
   SSO login. The same applies to `MELLON_ENDPOINT` for mod_auth_mellon.

---

## Booking window

| Variable           | Default | Description                                                                                                                    |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `WEEKS_IN_ADVANCE` | `1`     | How many weeks past the current week are bookable in the calendar grid. `0` means only the current week; `1` means next week too. Days past the window render greyed out (not selectable). |
| `BOOK_OPEN`        | `0`     | Earliest bookable time, in seconds from midnight. `0` = 00:00.                                                                 |
| `BOOK_CLOSE`       | `86400` | Latest bookable time, in seconds from midnight. `86400` = 24:00.                                                               |
| `OMITTED_WEEKDAYS` | `[]`    | List of weekday numbers that are not bookable. They render **greyed out** in the calendar grid (shown for context, not hidden). `0`=Monday, `6`=Sunday. |
| `WEEK_START_DAY`   | `0`     | The weekday shown in the first (leftmost) column of the booking calendar grid. `0`=Monday (default), `6`=Sunday. Same numbering as `OMITTED_WEEKDAYS`. Affects display only — it does not change which days are bookable. |

Common examples:

```sh
WARP_BOOK_OPEN=32400              # 09:00 AM  (9 × 3600)
WARP_BOOK_CLOSE=64800             # 06:00 PM  (18 × 3600)
WARP_OMITTED_WEEKDAYS="[5, 6]"   # grey out Saturday and Sunday
WARP_WEEKS_IN_ADVANCE=2           # two weeks of future dates
WARP_WEEK_START_DAY=6             # start the calendar week on Sunday
```

Per-seat booking windows (days-in-advance) are set in the plan editor and are
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
| `MAX_MAP_SIZE`       | `2 MB`  | Maximum size for plan image uploads (JPEG or PNG).                                                                   |
| `MAX_CONTENT_LENGTH` | `5 MB`  | Maximum HTTP request body size enforced by Flask.                                                                        |

---

## Calendar / iCal

| Variable                | Default     | Description                                                                                                              |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |

---

## Authentication providers

WARP ships with built-in username/password auth. Four optional SSO providers are
available; only one can be active at a time.

| Provider                | Enable with        | Notes                                                                 |
| ----------------------- | ------------------ | --------------------------------------------------------------------- |
| Built-in (default)      | —                  | Users authenticate with a login + password stored in WARP's database. |
| LDAP / Active Directory | `AUTH_LDAP=true`   | See [LDAP configuration](#ldap--active-directory).                    |
| Azure Active Directory  | `AUTH_AAD=true`    | See [Azure AD configuration](#azure-active-directory-aad).            |
| OpenID Connect (OIDC)   | `AUTH_OIDC=true`   | See [OIDC configuration](#openid-connect-oidc).                      |
| SAML 2.0 (native)      | `AUTH_SAML=true`  | See [native SAML configuration](#saml-20-native).                     |
| SAML 2.0 (legacy/Mellon)| `AUTH_MELLON=true` | See [SAML configuration](#saml-20-via-apache-mod_auth_mellon).        |

All SSO providers support:

- **Auto-provisioning**: a WARP user account is created automatically on first login.

Additionally:

- **Group mapping**: LDAP, Azure AD, OIDC, and native SAML support mapping identity-provider groups to WARP groups (see [Group mapping](#ldap-group-mapping)). SAML/Mellon only has a single default group.
- **Excluded users**: LDAP, OIDC, and native SAML allow specific logins to be kept on local password auth even when SSO is active. Azure AD and SAML/Mellon do not support excluded users.

### Case-insensitive logins

| Setting            | Default | Description                                          |
| ------------------ | ------- | ---------------------------------------------------- |
| `LOGIN_IGNORECASE` | `true`  | Match logins regardless of letter case, all backends |

With `LOGIN_IGNORECASE` enabled (the default), a login entered in any case
(`jdoe`, `JDoe`, `JDOE`) resolves to the same stored account, and the session,
bookings, and group membership stay keyed to the single login already stored.
This prevents duplicate accounts when the identity provider treats names
case-insensitively (common with LDAP/Active Directory). The stored login keeps
its original case; only matching is case-insensitive. Disable it only if your
directory genuinely distinguishes users by letter case.

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

| variable:      | `LDAP_USER_NAME_ATTRIBUTE`                                                                                                                                                              |
| :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string` or `array of string`                                                                                                                                                          |
| default value: | `cn`                                                                                                                                                                                    |
| description:   | LDAP attribute used as the user's display name in WARP. May be a JSON array of attributes (e.g. `["givenName","sn"]`); their values are joined with a space. Falls back to the login when none are present. |

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
WARP_LDAP_USER_NAME_ATTRIBUTE='"cn"'   # or a JSON array, e.g. '["givenName","sn"]'
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

| variable:      | `AAD_USER_NAME_ATTRIBUTE`                                                                                                                                                              |
| :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string` or `array of string`                                                                                                                                                          |
| default value: | `name`                                                                                                                                                                                  |
| description:   | OIDC claim used as the user's display name in WARP. May be a JSON array of claims (e.g. `["given_name","family_name"]`); their values are joined with a space. Falls back to the login when none are present. |

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

## OpenID Connect (OIDC)

Set `AUTH_OIDC=true` and configure `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, and
`OIDC_CLIENT_SECRET`. WARP discovers all endpoints and keys from the IdP's
`.well-known/openid-configuration` document, so no per-endpoint configuration is
needed.

Works with any OIDC-compliant identity provider: Keycloak, Authentik, Okta, Auth0,
Google, Entra ID (generic OIDC mode), and others.

Features: auto-provisioning, display name sync on every login, same group mapping
model as LDAP, excluded users, ID-token verification (signature, nonce, issuer,
audience, expiry).

### Configuration variables

| variable:      | `AUTH_OIDC`                                         |
| :------------- | :-------------------------------------------------- |
| type:          | `boolean`                                           |
| default value: | `False`                                             |
| description:   | Set to `True` to enable OpenID Connect authentication. |

| variable:      | `OIDC_DISCOVERY_URL`                                                                              |
| :------------- | :------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                           |
| default value: | `None` (must be defined)                                                                           |
| description:   | Full URL of the IdP's `.well-known/openid-configuration` document. WARP loads all endpoints and signing keys from here. |
| example:       | Keycloak: `https://idp.example.org/realms/warp/.well-known/openid-configuration`                    |

| variable:      | `OIDC_CLIENT_ID`                    |
| :------------- | :---------------------------------- |
| type:          | `string`                            |
| default value: | `None` (must be defined)            |
| description:   | OAuth2 client ID registered at the IdP. |

| variable:      | `OIDC_CLIENT_SECRET`                                                                                    |
| :------------- | :------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                 |
| default value: | `None` (required for confidential clients)                                                               |
| description:   | OAuth2 client secret. Treat this like a password. Public clients (SPA/native) may leave this unset. Supports the `_FILE` convention — see [Secrets / `_FILE` convention](#secrets--_file-convention). |

| variable:      | `OIDC_SCOPES`                                                                             |
| :------------- | :---------------------------------------------------------------------------------------- |
| type:          | `string` (space-separated)                                                                |
| default value: | `openid profile email`                                                                    |
| description:   | OAuth2 scopes requested during the authorisation request. `openid` is required; add others depending on what claims your IdP provides. |

| variable:      | `OIDC_LOGIN_ATTRIBUTE`                                                                                      |
| :------------- | :---------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                    |
| default value: | `preferred_username`                                                                                        |
| description:   | OIDC claim used as the WARP login (username). Change to `email` or `sub` if `preferred_username` is not populated by your IdP. |

| variable:      | `OIDC_USER_NAME_ATTRIBUTE`                           |
| :------------- | :-------------------------------------------------- |
| type:          | `string`                                            |
| default value: | `name`                                              |
| description:   | OIDC claim used as the user's display name in WARP. |

| variable:      | `OIDC_GROUPS_CLAIM`                                                                    |
| :------------- | :------------------------------------------------------------------------------------- |
| type:          | `string`                                                                               |
| default value: | `groups`                                                                               |
| description:   | Name of the OIDC claim holding the user's group list. Some IdPs use `roles` or `member`. |

| variable:      | `OIDC_GROUP_MAP`                                                                                                |
| :------------- | :------------------------------------------------------------------------------------------------------------- |
| type:          | `array` of `[string\|null, string\|null]` pairs                                                                  |
| default value: | `[ [null, null] ]`                                                                                              |
| description:   | Maps OIDC groups to WARP groups. Same semantics as [`LDAP_GROUP_MAP`](#ldap-group-mapping).                     |

| variable:      | `OIDC_GROUP_STRICT_MAPPING`                                                                                                             |
| :------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `boolean`                                                                                                                               |
| default value: | `False`                                                                                                                                 |
| description:   | When `True`, removes WARP group memberships not matched by the group map on each login. Same semantics as `LDAP_GROUP_STRICT_MAPPING`. |

| variable:      | `OIDC_EXCLUDED_USERS`                                                                                                                       |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| type:          | `array` of `string`                                                                                                                         |
| default value: | `[]`                                                                                                                                        |
| description:   | Logins that always authenticate against WARP's local password database, even when OIDC is enabled. Useful for keeping a local admin account. |

| variable:      | `OIDC_HTTPS_SCHEME`                                                                                                                                                   |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`: `https` or `http`                                                                                                                                          |
| default value: | `https`                                                                                                                                                               |
| description:   | Scheme used when constructing the OAuth2 redirect URI. Change to `http` only in local development. Behind a reverse proxy that terminates TLS, keep `https` so the redirect URI matches what is registered at the IdP. |

| variable:      | `OIDC_USERINFO`                                                                                                                      |
| :------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `boolean`                                                                                                                             |
| default value: | `False`                                                                                                                               |
| description:   | When `True`, WARP also calls the UserInfo endpoint after the ID token is validated and merges the returned claims. Some IdPs only expose groups in the UserInfo response, not in the ID token. |

### Redirect URI

Register the following redirect URI at your IdP:

```
https://<your-warp-host>/oidc/callback
```

The `OIDC_HTTPS_SCHEME` setting controls the scheme of this URI. In production
behind a reverse proxy, keep it as `https` (the default) even if WARP itself
listens on `http`, because the proxy rewrites the scheme.

### Client secret `_FILE` convention

The client secret can be supplied via a file (for Docker/Podman secrets) instead
of an environment variable:

```
WARP_OIDC_CLIENT_SECRET_FILE=/run/secrets/oidc_client_secret
```

See [Secrets / `_FILE` convention](#secrets--_file-convention) for details.

### Example configuration (Keycloak)

```sh
WARP_AUTH_OIDC="true"
WARP_OIDC_DISCOVERY_URL="https://idp.example.org/realms/warp/.well-known/openid-configuration"
WARP_OIDC_CLIENT_ID="warp"
WARP_OIDC_CLIENT_SECRET_FILE="/run/secrets/warp_oidc_client_secret"
WARP_OIDC_GROUPS_CLAIM="groups"
WARP_OIDC_GROUP_MAP="[ ['warp-allowed', null], [null, 'Everyone'] ]"
WARP_OIDC_EXCLUDED_USERS="['admin']"
```

---

## SAML 2.0 (native)

Set `AUTH_SAML=true` and configure the SP entity ID and at least one IdP configuration
method (metadata URL preferred, or manual endpoints + certificate). WARP uses
`python3-saml` as a native SAML Service Provider — **no Apache reverse proxy is
required**.

Works with any SAML 2.0 identity provider: Keycloak, Authentik, Okta, Auth0,
ADFS, Entra ID, Shibboleth, and others.

Features: auto-provisioning, display name sync on every login, same group mapping
model as LDAP/OIDC, excluded users, SP-initiated Single Logout (SLO), SP metadata
endpoint, signed assertion / signed AuthnRequest support.

### Configuration variables

| variable:      | `AUTH_SAML`                                                       |
| :------------- | :---------------------------------------------------------------- |
| type:          | `boolean`                                                         |
| default value: | `False`                                                           |
| description:   | Set to `True` to enable native SAML 2.0 authentication.          |

| variable:      | `SAML_SP_ENTITY_ID`                                                                            |
| :------------- | :--------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                       |
| default value: | `None` (must be defined)                                                                       |
| description:   | SP entity ID (issuer). Typically `https://<host>/saml/metadata`.                                |

| variable:      | `SAML_ENDPOINT_PATH`                                                                                       |
| :------------- | :-------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                  |
| default value: | `/saml`                                                                                                   |
| description:   | Base path under which the SP endpoints are mounted (ACS `<path>/acs`, SLS `<path>/sls`, metadata `<path>/metadata`, SSO-start `<path>/login`). Equivalent to Mellon's `MellonEndpointPath`. `/login` and `/logout` always stay at the root. |

| variable:      | `SAML_IDP_METADATA_URL`                                                                                  |
| :------------- | :-------------------------------------------------------------------------------------------------------|
| type:          | `string`                                                                                                |
| default value: | `None`                                                                                                  |
| description:   | IdP metadata URL. WARP auto-loads the IdP entity ID, SSO URL, SLO URL, and signing certificate. Prefer this over manual configuration. |
| example:       | Keycloak: `https://idp.example.org/realms/warp/protocol/saml/descriptor`                                 |

| variable:      | `SAML_IDP_METADATA_FILE`                                                                                  |
| :------------- | :-------------------------------------------------------------------------------------------------------- |
| type:          | `string` (file path)                                                                                     |
| default value: | `None`                                                                                                   |
| description:   | Path to a local IdP metadata XML file — the same role as Mellon's `MellonIdPMetadataFile`. Use this when the IdP only offers a downloadable metadata file (e.g. Okta) or the WARP host has no egress to fetch `SAML_IDP_METADATA_URL`. The file contents are loaded into `SAML_IDP_METADATA` via the `_FILE` convention. Precedence: `SAML_IDP_METADATA_URL` > file/inline metadata > manual `SAML_IDP_*` fields. |

| variable:      | `SAML_IDP_METADATA`                                                                                       |
| :------------- | :-------------------------------------------------------------------------------------------------------- |
| type:          | `string` (XML)                                                                                           |
| default value: | `None`                                                                                                   |
| description:   | IdP metadata XML provided inline (alternative to the file/URL). Usually set indirectly via `SAML_IDP_METADATA_FILE`. |

| variable:      | `SAML_IDP_ENTITY_ID`                                            |
| :------------- | :-------------------------------------------------------------- |
| type:          | `string`                                                        |
| default value: | `None`                                                          |
| description:   | Manual IdP entity ID (when no metadata URL is available).       |

| variable:      | `SAML_IDP_SSO_URL`                                              |
| :------------- | :-------------------------------------------------------------- |
| type:          | `string`                                                        |
| default value: | `None`                                                          |
| description:   | Manual IdP SSO (redirect) URL.                                  |

| variable:      | `SAML_IDP_SLO_URL`                                              |
| :------------- | :-------------------------------------------------------------- |
| type:          | `string`                                                        |
| default value: | `None`                                                          |
| description:   | Manual IdP Single Logout URL.                                    |

| variable:      | `SAML_IDP_X509_CERT`                                            |
| :------------- | :-------------------------------------------------------------- |
| type:          | `string`                                                        |
| default value: | `None`                                                          |
| description:   | IdP signing certificate (PEM body). Supports the `_FILE` convention. |

| variable:      | `SAML_SP_X509_CERT`                                             |
| :------------- | :-------------------------------------------------------------- |
| type:          | `string`                                                        |
| default value: | `None`                                                          |
| description:   | SP certificate for signed AuthnRequests / metadata. Supports the `_FILE` convention. |

| variable:      | `SAML_SP_PRIVATE_KEY`                                           |
| :------------- | :-------------------------------------------------------------- |
| type:          | `string`                                                        |
| default value: | `None`                                                          |
| description:   | SP private key (signing/decryption). Supports the `_FILE` convention. |

| variable:      | `SAML_NAMEID_FORMAT`                                                                                                      |
| :------------- | :------------------------------------------------------------------------------------------------------------------------ |
| type:          | `string`                                                                                                                  |
| default value: | `urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified`                                                                   |
| description:   | Requested NameID format sent in the AuthnRequest. Change only if your IdP requires a specific format (e.g. `urn:oasis:names:tc:SAML:2.0:nameid-format:transient`). |

| variable:      | `SAML_LOGIN_ATTRIBUTE`                                                                                                     |
| :------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`                                                                                                                    |
| default value: | `""` (empty — use NameID)                                                                                                   |
| description:   | SAML attribute used as the WARP login. When empty (the default), the assertion NameID is used instead.                      |

| variable:      | `SAML_USER_NAME_ATTRIBUTE`                              |
| :------------- | :------------------------------------------------------ |
| type:          | `string`                                                |
| default value: | `cn`                                                    |
| description:   | SAML attribute used as the user's display name in WARP. |

| variable:      | `SAML_GROUPS_ATTRIBUTE`                                                          |
| :------------- | :------------------------------------------------------------------------------- |
| type:          | `string`                                                                         |
| default value: | `groups`                                                                         |
| description:   | SAML attribute holding the user's group list. Some IdPs use `memberOf`.          |

| variable:      | `SAML_GROUP_MAP`                                                                                                    |
| :------------- | :----------------------------------------------------------------------------------------------------------------- |
| type:          | `array` of `[string\|null, string\|null]` pairs                                                                      |
| default value: | `[ [null, null] ]`                                                                                                  |
| description:   | Maps SAML groups to WARP groups. Same semantics as [`LDAP_GROUP_MAP`](#ldap-group-mapping).                        |

| variable:      | `SAML_GROUP_STRICT_MAPPING`                                                                                                             |
| :------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `boolean`                                                                                                                              |
| default value: | `False`                                                                                                                                |
| description:   | When `True`, removes WARP group memberships not matched by the group map on each login. Same semantics as `LDAP_GROUP_STRICT_MAPPING`. |

| variable:      | `SAML_EXCLUDED_USERS`                                                                                                                       |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| type:          | `array` of `string`                                                                                                                         |
| default value: | `[]`                                                                                                                                         |
| description:   | Logins that always authenticate against WARP's local password database, even when SAML is enabled. Useful for keeping a local admin account. |

| variable:      | `SAML_HTTPS_SCHEME`                                                                                                                                                   |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| type:          | `string`: `https` or `http`                                                                                                                                           |
| default value: | `https`                                                                                                                                                               |
| description:   | Scheme used when constructing SP endpoint URLs (ACS, SLS, metadata). Behind a reverse proxy that terminates TLS, keep `https` (the default) so the URLs match what is registered at the IdP. |

| variable:      | `SAML_AUTHN_REQUESTS_SIGNED`                                                                    |
| :------------- | :--------------------------------------------------------------------------------------------- |
| type:          | `boolean`                                                                                       |
| default value: | `False`                                                                                         |
| description:   | When `True`, outgoing AuthnRequests are signed. Requires `SAML_SP_PRIVATE_KEY` and `SAML_SP_X509_CERT`. |

| variable:      | `SAML_WANT_ASSERTIONS_SIGNED`                                                                                       |
| :------------- | :------------------------------------------------------------------------------------------------------------------ |
| type:          | `boolean`                                                                                                           |
| default value: | `True`                                                                                                              |
| description:   | Require signed assertions from the IdP. **Do not disable in production** unless your IdP cannot sign assertions.   |

| variable:      | `SAML_WANT_MESSAGES_SIGNED`                                                                                         |
| :------------- | :------------------------------------------------------------------------------------------------------------------ |
| type:          | `boolean`                                                                                                           |
| default value: | `False`                                                                                                             |
| description:   | Require signed SAML messages (response-level signature) from the IdP.                                              |

### SP endpoints

Register the following endpoints at your IdP (the `/saml` base path is
[`SAML_ENDPOINT_PATH`](#configuration-variables-6), shown here at its default):

| Endpoint       | URL                                        | Binding       |
| --------------- | ------------------------------------------ | ------------- |
| ACS (Assertion Consumer Service) | `https://<host>/saml/acs`  | HTTP-POST     |
| SLS (Single Logout Service)       | `https://<host>/saml/sls`  | HTTP-Redirect |
| SP metadata                      | `https://<host>/saml/metadata` | `GET` (browser)  |

The `SAML_HTTPS_SCHEME` setting controls the scheme of these URLs. In production
behind a reverse proxy, keep it as `https` (the default) even if WARP itself
listens on `http`, because the proxy rewrites the scheme.

You can also point your IdP to `https://<host>/saml/metadata` to auto-load the
SP metadata XML (entity ID, ACS URL, SLS URL, SP certificate).

### Session cookie and the SAML POST binding

The IdP returns the assertion as a **cross-site POST** to the ACS endpoint, so
the browser must include WARP's session cookie on that POST for RelayState and
replay (`InResponseTo`) protection to work. Flask's default makes the cookie
`SameSite=Lax`, which browsers do **not** send on cross-site POSTs. For SAML,
set the cookie to `SameSite=None; Secure` — the native equivalent of Mellon's
`MellonCookieSameSite none` / `MellonSecureCookie On`:

```
WARP_SESSION_COOKIE_SAMESITE=None
WARP_SESSION_COOKIE_SECURE=true
```

`SameSite=None` **requires** `Secure`, so WARP must be served over HTTPS. If you
leave the default `Lax`, SSO still works but falls back to the unsolicited path
(no `InResponseTo` validation, unreliable RelayState).

### Migrating from `mod_auth_mellon`

| Mellon directive            | Native SAML setting |
| --------------------------- | ------------------- |
| `MellonEnable auth`         | `WARP_AUTH_SAML=true` |
| `MellonUser "uid"`          | `WARP_SAML_LOGIN_ATTRIBUTE=uid` (omit / leave empty to use the NameID) |
| `MellonSPPrivateKeyFile`    | `WARP_SAML_SP_PRIVATE_KEY_FILE` |
| `MellonSPCertFile`          | `WARP_SAML_SP_X509_CERT_FILE` |
| `MellonIdPMetadataFile`     | `WARP_SAML_IDP_METADATA_FILE` (or `WARP_SAML_IDP_METADATA_URL`) |
| `MellonEndpointPath /sp`    | `WARP_SAML_ENDPOINT_PATH=/sp` |
| `MellonSecureCookie On`     | `WARP_SESSION_COOKIE_SECURE=true` |
| `MellonCookieSameSite none` | `WARP_SESSION_COOKIE_SAMESITE=None` |

Note the SP endpoint paths differ from Mellon's: the ACS is `<path>/acs` (not
`<path>/postResponse`) and SLS is `<path>/sls`, so re-register the SP at your IdP
(easiest: import `https://<host>/saml/metadata`).

### Secret `_FILE` convention

Secrets can be supplied via files (for Docker/Podman secrets) instead of
environment variables:

```
WARP_SAML_SP_PRIVATE_KEY_FILE=/run/secrets/saml_sp_private_key
WARP_SAML_IDP_X509_CERT_FILE=/run/secrets/saml_idp_cert
WARP_SAML_SP_X509_CERT_FILE=/run/secrets/saml_sp_cert
```

See [Secrets / `_FILE` convention](#secrets--_file-convention) for details.

### Example configuration (Keycloak SAML)

```sh
WARP_AUTH_SAML="true"
WARP_SAML_SP_ENTITY_ID="https://warp.example.org/saml/metadata"
WARP_SAML_IDP_METADATA_URL="https://idp.example.org/realms/warp/protocol/saml/descriptor"
WARP_SAML_SP_PRIVATE_KEY_FILE="/run/secrets/warp_saml_sp_private_key"
WARP_SAML_GROUPS_ATTRIBUTE="groups"
WARP_SAML_GROUP_MAP="[ ['warp-allowed', null], [null, 'Everyone'] ]"
WARP_SAML_EXCLUDED_USERS="['admin']"
```

---

## SAML 2.0 via Apache mod_auth_mellon

> **Note:** This is the **legacy** SAML backend. For new deployments, use
> [native SAML (`AUTH_SAML=true`)](#saml-20-native) instead — it requires no
> Apache reverse proxy and supports group mapping, excluded users, and
> SP-initiated Single Logout.

WARP supports SAML 2.0 via the Apache [mod_auth_mellon](https://github.com/latchset/mod_auth_mellon)
module. This is the **legacy** backend; use [native SAML](#saml-20-native) for new deployments.
Authentication and logout are handled entirely by the Apache reverse proxy; WARP reads
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
