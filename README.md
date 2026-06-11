### Known issues
Runs only with Postgres 18. 
Has interesting driver issues with version 16, 17 
where Strings from database returned as binary. 
Downgrading driver to 2.9.9 requires changes to configuration,
skipped. 

# Announcement

This project is maintained by me and a couple of friends - though honestly, mainly by my friends, since my time is "very limited" (read: I mostly just approve their PRs). Those friends? Opus, Sonnet, Gemini, DeepSeek, and GLM. The kind that never sleep, never complain about code reviews, and possibly, just maybe don't have feelings. If you'd like to join the team as the rarest specimen, someone who runs on coffee instead of API tokens, we desperately need you.

# WARP: Workspace Autonomous Reservation Program

The story of this project begins when, due to COVID-19, we have converted our regular office into a hybrid of regular and hot-desk assignments. We needed to find a solution for desk reservations, transparency of that, and detailed logging of who was in the office for epidemic purposes.

I've quickly evaluated a couple of existing solutions, but they were either too big and complicated and/or too expensive. As I assumed that other people would have the same challenge I had, I decided to spend my after-hours time making an open-source tailored system for the need. Yes - it is free as speech, not as beer.

## What WARP can do

- It allows people to book / change / unbook desks (or even parking stalls) in the office.
- It allows people to check who else will be in the office.
- It works on mobile.
- All is done in an easy, visual way.
- Generate a report of past bookings and export it to Excel file
- Generate and subscribe to interactive iCal feeds for automatic booking reminders in any calendar app
- Change password and manage calendar preferences from the user menu
- Receive automatic notifications for upcoming bookings

## More advanced features

- **Admin Interface**: Full admin interface to add/remove/edit maps, zones, groups, and users.
- **Admin Booking**: Admins can book, modify, or unbook seats for any user.
- **Multiple Zones**: Create multiple zones (maps) for different areas like floors or parking.
- **Zone Groups**: Group zones so that one person can have only one seat booked simultaneously within a group (e.g., one group for floors, another for parking).
- **Assigned Seats**: Limit seats to certain people so others cannot book them.
- **Disabled Seats**: Hide seats so people don't see them at all.
- **Auto-Book**: Use the floating "+" button to quickly book an available seat with one click.
- **Calendar Integration**: Subscribe to iCal feeds in Google Calendar, Outlook, Apple Calendar, or any other calendar app. The feed includes all your bookings with one-click actions to release seats.
- **Per-Zone Reminders**: Configure automatic booking and seat-release reminder notifications for each zone independently.
- **Days-in-Advance Booking Window**: Per-assignment configurable limits on how far in advance users can book seats.
- **Virtual "Everyone" Access**: Seats and zones can be configured with virtual "everyone" access for flexible seat management.
- **Translations**: Currently supports English, German, French, Spanish, and Polish.
- **SAML2.0**: Via Apache [mod_auth_mellon](https://github.com/latchset/mod_auth_mellon) module.
- **LDAP/Active Directory**: Via LDAP3 library.

## What I'm not even planning to do

- Approvals - the main goal of the system was to make it autonomous and management-free. So I don't intend to implement approval flows.
- Timezone support - the selected time is always in the same timezone as a zone. It works well and is simple. But in case someone would like to have a couple of zones in different timezones and keep the `one person one seat at a given time` rule across these timezones, this will fail.

## What browsers are supported

To be honest, I was not paying much attention to browser compatibility, nor was I extensively testing it on other browsers than Chrome and Firefox. Nevertheless, all modern browsers should be supported (definitely not IE).

## Is there any demo?

![demo animation](res/demo.gif)

It is so easy to run it via docker compose that I have removed the demo, which was available some time ago.

# Deployment

During the first run on an empty database, WARP will populate the database schema and create an admin user.

Default admin credentials are: `admin:noneshallpass`

## Upgrading

Schema migrations are applied automatically on startup. WARP tracks the current schema version in the database and applies any pending migration scripts from `warp/sql/` in order.

Currently shipped migrations:

| File | Required when upgrading from |
|:---|:---|
| `migration_001_days_in_advance.sql` | a version before the `days_in_advance` per-assignment booking window |
| `migration_002_zone_type.sql` | a version before zone type feature |
| `migration_003_seat_assign_everyone.sql` | a version before virtual "everyone" access |
| `migration_004_user_prefs.sql` | a version before user preferences feature |
| `migration_005_ical.sql` | a version before iCal calendar integration |
| `migration_006_calendar_reminders.sql` | a version before per-zone booking reminders |
| `migration_007_calendar_cache.sql` | a version before iCal caching optimization |
| `migration_008_zone_default_type.sql` | a version before zone default type feature |
| `migration_009_zone_preview_prefs.sql` | a version before zone preview preferences |

## Demo quickstart

The preferred way to deploy is to run it via Docker. You need a working docker, and I won't cover it here.

### docker compose

From the command line:

```
# clone the repository
$ git clone https://github.com/sebo-b/warp.git
$ cd warp

$ docker compose -f demo_compose.yaml up
```

After that, open http://127.0.0.1:8080 in your browser and log in as `admin` with password `noneshallpass`.

### without docker compose (but why?)

From the command line:

```
# clone the repository
$ git clone https://github.com/sebo-b/warp.git
$ cd warp

# build docker image (you can skip hash if you don't want to track it)
$ export GIT_HASH=`git log -1 --format=%h`
$ docker build -t warp:latest -t warp:$GIT_HASH .

# install postrgres (what I cover here is a simplistic way just to run a demo)
$ docker pull postgres
$ docker run --name warp-demo-db -e POSTGRES_PASSWORD=postgres_password -d postgres
$ export WARP_DEMO_DB_IP=`docker inspect  -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' warp-demo-db`

# start warp
$ docker run --name warp-demo-wsgi \
> --env 'WARP_DATABASE=psycopg3://postgres:postgres_password@warp-demo-db:5432/postgres' \
> --env WARP_SECRET_KEY=mysecretkey \
> --env WARP_DATABASE_POST_INIT_SCRIPTS='["sql/sample_data.sql"]' \
> --add-host=warp-demo-db:${WARP_DEMO_DB_IP} -d warp:latest
$ export WARP_DEMO_WSGI_IP=`docker inspect  -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' warp-demo-wsgi`

# install nginx as wsgi rewerse proxy
$ docker pull nginx
$ docker run --add-host=warp-demo-wsgi:${WARP_DEMO_WSGI_IP} --mount type=bind,source="$(pwd)"/res/nginx.conf,target=/etc/nginx/conf.d/default.conf,readonly -d -p 127.0.0.1:8080:80 nginx
```

After that, open http://127.0.0.1:8080 in your browser and log in as `admin` with password `noneshallpass`.

### without Docker - the old way

You need a working Python3 environment, Node.js, and PostgreSQL, and I won't cover it here. This is not a preferred way, use it only for debugging or development purposes. Things may change, and this section can be outdated - but I assume that you know what you are doing.

From the command line:

```
# clone repo
$ git clone https://github.com/sebo-b/warp.git
$ cd warp

# create virtual envirnoment and activate it
$ python3 -m venv --prompt warp .venv
$ source .venv/bin/activate

# install python requirements
# if this raises an error in psycopg2, either install its all build dependencies
# or change psycopg2 to psycopg2-binary in requirements.txt
$ pip install -r requirements.txt

# compile JavaScript files
$ pushd js
$ npm ci
$ npm run build
$ popd

# setup database URL, if it is different than the default for debug (specified below)
$ export WARP_DATABASE=psycopg3://postgres:postgres_password@127.0.0.1:5432/postgres

# run the app
$ flask --app warp --debug run
```

After that, open http://127.0.0.1:5000 in your browser and log in as `admin` with password `noneshallpass`.

## Production environment

For the production environment, I recommend running Nginx and PostgreSQL on separate VMs. Then (even multiple) WARP image can be simply started via Docker and rev-proxed from Nginx.

**Database Driver**: WARP now uses the `psycopg3://` driver (psycopg 3). Make sure your database URLs use this scheme.

Example database configuration:
```
WARP_DATABASE=psycopg3://user:password@hostname:5432/warp_db
```

Each configuration parameter (check config.py) can be passed via the envirnoment as `WARP_varname`.
As environment variables as passed as strings, they need to be parsed into Python types and data structures.
To do that values are first converted to lower case and then `json.loads` is used. If that fails variable is treaten as string.
This makes possible to pass integers, floats, booleans as well as dicts, arrays and None value (as JSON null).

### Database initialization variables

|variable:|`DATABASE_PRE_INIT_SCRIPTS`|
|:---|:---|
|type:|`array` of `strings`|
|default value:|`[]`|
|description:|JSON array of SQL file paths to execute before the schema whenever the database is initialized (both on first run and force-reinit). Typically used for teardown/cleanup scripts in development.|

|variable:|`DATABASE_SCHEMA`|
|:---|:---|
|type:|`string`|
|default value:|`"sql/schema.sql"`|
|description:|Path to the canonical schema file. Rarely needs overriding.|

|variable:|`DATABASE_POST_INIT_SCRIPTS`|
|:---|:---|
|type:|`array` of `strings`|
|default value:|`[]`|
|description:|JSON array of SQL file paths to execute after the schema on first init (e.g. seed data).|

|variable:|`DATABASE_MIGRATION_SCRIPTS`|
|:---|:---|
|type:|`array` of `(integer, string)` tuples|
|default value:|see `config.py`|
|description:|Ordered list of `(version, path)` tuples for automatic schema migrations. On startup, any migration with a version higher than the current database version is applied in order. Rarely needs overriding.|

### SECRET_KEY

For the production environment, **make sure** that you have generated `SECRET_KEY` used for signing cookies. It is defined in `config.py.`

Flask documentation mentions this method to generate it:

```
$ python -c 'import os; print(os.urandom(16))'
```

Alternatively, you can use OpenSSL and Sed:

```
$ openssl rand -hex 16 | sed 's/\(..\)/\\x\1/g;s/^/b"/;s/$/"/'
```

or wrap it into Python:

```
$ python -c 'from subprocess import run; print(run(["openssl","rand","16"],capture_output=True).stdout)'
```

### Language

Change `LANGUAGE_FILE` variable in `config.py` or set `WARP_LANGUAGE_FILE` environment variable. Currently, language is global for the instance.

## User Preferences and Calendar Integration

WARP provides a user preferences system accessible from the user menu, allowing users to manage their calendar integration settings and change their password.

### Calendar Feed Integration

WARP generates an iCal feed for each user that includes all their current and future bookings. Users can subscribe to this feed in their preferred calendar application (Google Calendar, Outlook, Apple Calendar, Mozilla Thunderbird, etc.) to automatically receive calendar events for their bookings.

**One-Click Actions in Calendar**: Each event in the iCal feed includes action buttons that allow users to release seats directly from their calendar without opening the WARP application.

**Feed URL**: Each user has a unique, secure iCal feed URL generated based on a user-specific token. The URL is accessible from the user preferences menu.

### Booking Reminders

When subscribed to the iCal feed, users automatically receive:
- **Booking Reminders**: Calendar events for each upcoming booking showing the seat location and booking date
- **Seat Release Notifications**: Calendar events when previously booked seats become available for re-booking

### Password Management

Users can change their password from the user menu. The minimum password length is configurable via the `MIN_PASSWORD_LENGTH` setting (default: 6 characters).

### Configuration Variables for Calendar and User Preferences

|variable:|`AUTOBOOK_USAGE_WINDOW_DAYS`|
|:---|:---|
|type:|`integer`|
|default value:|`30`|
|description:|Number of days in the future for which the auto-book feature can suggest and book seats. Limits the window for the floating "+" button functionality.|

|variable:|`MIN_PASSWORD_LENGTH`|
|:---|:---|
|type:|`integer`|
|default value:|`6`|
|description:|Minimum required length for user passwords when changed via the user preferences menu.|

# Advanced configuration

## LDAP authentication (including Active Directory)

WARP supports authentication against an LDAP server. In this way your LDAP directory users to log in on your WARP installation.

To enable LDAP auth, you need to set `AUTH_LDAP` to `True` and at least configure `LDAP_SERVER_URL`, `LDAP_USER_DN_TEMPLATE`. Probably you will need to tweak more parameters to make it working with your LDAP setup, so keep reading.

This plugin supports:
- LDAP over plain text, SSL or StartTLS
- SIMPLE or NTLM LDAP authentication
- automatic Warp user creation on the first login
- replicating user name and user groups from LDAP
- limiting access only to users within a specific LDAP group(s)
- exclude users (e.g. admins) from LDAP login

### Configuration variables

Please note that every variable can be set either in the config file or via the environment (in that case, it needs to be prefixed by `WARP_` string).

|variable:|`AUTH_LDAP`|
|:---|:---|
|type:|`boolean`|
|default value:|`False`|
|description:|If set to `True` enables LDAP authentication|


|variable:|`LDAP_SERVER_URL`|
|:---|:---|
|type:|`string`|
|default value:|`None` (have to be defined)|
|description:|Server url, either `ldap://address[:port]` or `ldaps://address[:port]`<br/>It must be `ldap://` for StartTLS |

|variable:|`LDAP_AUTH_TYPE`|
|:---|:---|
|type:|`string`: `SIMPLE` or `NTLM`|
|default value:|`SIMPLE`|
|description:|LDAP authentication type.<br/>For `NTLM` see [Active Directory authentication ](#Active-Directory-authentication) for more details.|

|variable:|`LDAP_STARTTLS`|
|:---|:---|
|type:|`boolean`|
|default value:|`True`|
|description:|If StartTLS should be invoked before bind.|

|variable:|`LDAP_VALIDATE_CERT`|
|:---|:---|
|type:|`boolean`|
|default value:|`False`|
|description:|If server certificate should be validated for `SSL` or `StartTLS`|

|variable:|`LDAP_TLS_VERSION`|
|:---|:---|
|type:|`string`: `TLSv1`, `TLSv1.1` or `TLSv1.2`|
|default value:|`None`|
|description:|TLS version to be user.<br/>If not set, default value from Python SSL module is used.|

|variable:|`LDAP_TLS_CIPHERS`|
|:---|:---|
|type:|`string`|
|default value:|`None`|
|description:|Limit TLS only to specified ciphers.<br/>If not set, default value from Python SSL module is used.|

|variable:|`LDAP_USER_TEMPLATE`|
|:---|:---|
|type:|`string`|
|default value:|`None`|
|description:|Template used for user authentication (bind) to LDAP. It must contain `{login}` placeholder.<br/>For OpenLDAP it is usually a distinguished name, for AD it is usually `Domain\\{login}`|
|example value:|OpenLDAP: `uid={login},ou=users,dc=example,dc=org`<br/>AD: `SAMDOM\{login}`|

|variable:|`LDAP_USER_SEARCH_BASE`|
|:---|:---|
|type:|`string`|
|default value:|`None`|
|description:|Search base used for fetching user data. If this is not defined, `LDAP_USER_TEMPLATE` is used as it is usually configured as DN for OpenLDAP.<br/>It can contain `{login}` placeholder.|
|example value:|OpenLDAP: `None`<br/>AD: `cn=users,dc=samdom,dc=example,dc=org`|

|variable:|`LDAP_USER_SEARCH_FILTER_TEMPLATE`|
|:---|:---|
|type:|`string`|
|default value:|`(objectClass=person)`|
|description:|Search filter used for fetching user data.<br/>If `LDAP_USER_SEARCH_BASE` is DN, it can even be `(objectClass=*)`.|
|example value:|OpenLDAP: `(objectClass=*)`<br/>AD: `(&(sAMAccountName={login})(objectClass=user))`|

|variable:|`LDAP_USER_NAME_ATTRIBUTE`|
|:---|:---|
|type:|`string`|
|default value:|`cn`|
|description:|Full user name LDAP atribute.|

|variable:|`LDAP_GROUP_SEARCH_BASE`|
|:---|:---|
|type:|`string`|
|default value:|`None` (have to be defined)|
|description:|Base for searching for user groups.<br/>Check the next sections for more advanced examples.|
|example value:|OpenLDAP: `ou=groups,dc=example,dc=org`<br/>AD: `CN=Users,DC=samdom,DC=example,DC=org`|

|variable:|`LDAP_GROUP_SEARCH_FILTER_TEMPLATE`|
|:---|:---|
|type:|`string`|
|default value:|`(&(memberUid={login})(cn={group}))`|
|description:|Search filter for user's group lookup.<br>It must contain `{login}` and `{group}` placeholders.<br>Check the next sections for more advanced examples.|
|example value:|AD: `(&(sAMAccountName={login})(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:={group}))`|

|variable:|`LDAP_GROUP_MAP`|
|:---|:---|
|type:|`array` of `tuples`|
|default value:|`[ [null,null] ]`|
|description:|See [LDAP group mapping section.](#LDAP-group-mapping)|

|variable:|`LDAP_GROUP_STRICT_MAPPING`|
|:---|:---|
|type:|`boolean`|
|default value:|`False`|
|description:|Should user be removed from Warp groups if such mapping is not present in LDAP.<br>See [LDAP group mapping section](#LDAP-group-mapping) for more details.|

|variable:|`LDAP_EXCLUDED_USERS`|
|:---|:---|
|type:|`array` of `strings`|
|default value:|`[]`|
|description:|List of logins to be excluded from LDAP authentication. <br/> This can be usable for admins|

### LDAP group mapping

With a proper `LDAP_GROUP_MAP` and `LDAP_GROUP_STRICT_MAPPING` you can achieve the following scenarios:
- allow only limited LDAP group to login to Warp
- add users to Warp groups based on LDAP groups
- remove users from Warp groups based on LDAP groups
- add users to specified default Warp groups

`LDAP_GROUP_MAP` must be an array of arrays of two strings. The first string is LDAP group, the second string is Warp group.

You can interpret that in the following way:
- what LDAP groups are allowing user to log in to Warp
- to what WARP groups user should be added to, based on LDAP groups

The following configurations of an entry are possible:

1.
```
[
['LDAP group 1',null],
['LDAP group 2',null]
]
```
User must be in one of the `LDAP group 1` or `LDAP group 2` to be allowed to log in to Warp.

2.
```
[
['LDAP group 1','WARP group A'],
['LDAP group 2','WARP group B']
]
```
As in the previous example user must be in one of the `LDAP group 1` or `LDAP group 2` to be allowed to log in to Warp. In addition, during logging in user will be also accordingly added to `WARP group A` and/or `WARP group B` (based on LDAP group membership).

3.
```
[
['LDAP group 1',null],
[null,'WARP group A']
[null,'WARP group B']
]
```
User must be in the `LDAP group 1` to be allowed to log in to Warp (the first entry). During logging in user will be always added to `WARP group A` and `WARP group B`.

4.
```
[
[null,null],
['LDAP group 1','WARP group A'],
['LDAP group 2','WARP group B']
]
```
The first entry (`[null,null]`) changes the standard behaviour and every LDAP user will be allowed to log in to Warp. In addition if user is in `LDAP group 1` and/or `LDAP group 2` will be accordingly added to `WARP group A` and/or `WARP group B`.

Of course you can build a more complicated scenarios with multiple mappings, multiple default Warp, and multiple LDAP groups without a mapping.

Only users from LDAP groups specified in this array are allowed to login to Warp, unless there is a special `[null,null]` entry in this array.

Warp groups are not automatically created by LDAP plugin, users are only added (and possibly removed) to an existing Warp groups.

If `LDAP_GROUP_STRICT_MAPPING` is set to `False` users are not removed from Warp groups based on LDAP group mapping mechanism.
If `LDAP_GROUP_STRICT_MAPPING` is set to `True` users are removed from all Warp groups not matched by the mapping.

### Active Directory authentication

The distinguished name is (usually?) not used for authenticating against Active Directory. The user name is in the form of `Domain\Username`, in such scenario the following variable needs to be properly configured (example values given):
```
WARP_LDAP_USER_TEMPLATE = "SAMDOM\\{login}"
WARP_LDAP_USER_SEARCH_BASE = "cn=Users,dc=samdom,dc=example,dc=org"
WARP_LDAP_USER_SEARCH_FILTER_TEMPLATE = "(&(sAMAccountName={login})(objectClass=user))"
```

This applies to both `SAMPLE` and `NTML` authentication mechanisms.

Please also note that backslash in most of the cases is the escape character, so after the domain in  `WARP_LDAP_USER_TEMPLATE`, it usually needs to be escaped (`\\`).

### `memberOf` LDAP attribute and `LDAP_MATCHING_RULE_IN_CHAIN`

In case you use `memberOf` (or similar) LDAP attribute to assign users to groups, the follwing setup should do the trick (example values given):
```
LDAP_GROUP_SEARCH_BASE = "CN=Users,DC=samdom,DC=example,DC=org"
LDAP_GROUP_SEARCH_FILTER_TEMPLATE = "(&(sAMAccountName={login})(objectClass=user)(memberOf={group}))"
```

In addition, if your server supports `LDAP_MATCHING_RULE_IN_CHAIN` you can specify it as follow:
```
LDAP_GROUP_SEARCH_BASE = "CN=Users,DC=samdom,DC=example,DC=org"
LDAP_GROUP_SEARCH_FILTER_TEMPLATE = "(&(sAMAccountName={login})(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:={group}))"
```

### Example configuration

#### For OpenLDAP
```
WARP_AUTH_LDAP = "True"
WARP_LDAP_SERVER_URL = "ldap://ldap.example.org:1389"
WARP_LDAP_USER_TEMPLATE = "uid={login},ou=users,dc=example,dc=org"
WARP_LDAP_GROUP_SEARCH_BASE = "ou=groups,dc=example,dc=org"
WARP_LDAP_GROUP_MAP = "[ ['WARP_allowed',null], [null,'Everyone'] ]"
WARP_LDAP_EXCLUDED_USERS = "['admin']"

# the following values are default, keeping here just for clarity
WARP_LDAP_STARTTLS = "True"
WARP_LDAP_VALIDATE_CERT = "False"
WARP_LDAP_USER_NAME_ATTRIBUTE = "cn"
WARP_LDAP_GROUP_SEARCH_FILTER_TEMPLATE = "(&(memberUid={login})(cn={group}))"
```

#### For Active Directory
```
WARP_AUTH_LDAP = "True"
WARP_LDAP_SERVER_URL = "ldaps://ldap.example.org:636"
WARP_LDAP_VALIDATE_CERT = "True"
WARP_LDAP_AUTH_TYPE = "NTLM"
WARP_LDAP_USER_TEMPLATE = "SAMDOM\\{login}"
WARP_LDAP_USER_SEARCH_BASE = "cn=Users,dc=samdom,dc=example,dc=org"
WARP_LDAP_USER_SEARCH_FILTER_TEMPLATE = "(&(sAMAccountName={login})(objectClass=user))"
WARP_LDAP_GROUP_SEARCH_BASE = "CN=Users,DC=samdom,DC=example,DC=org"
WARP_LDAP_GROUP_SEARCH_FILTER_TEMPLATE = "(&(sAMAccountName={login})(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:={group}))"
WARP_LDAP_EXCLUDED_USERS = "['admin']"
WARP_LDAP_GROUP_MAP = "[ ['CN=warp_allowed,CN=Users,DC=samdom,DC=example,DC=com','AD users'], [null,'Everyone'] ]"
```

### How to import users

You can add them manually one by one via the users' management tab or import them directly to the database. Basically, insert users to `user` table, look at the table definition in `warp/sql/schema.sql.`

The role is one of:

```
10 - admin
20 - regular user
90 - account blocked
```

Password is a hash used by `werkzeug.security.check_password_hash` (more documentation can be [found here](https://werkzeug.palletsprojects.com/en/2.0.x/utils/#werkzeug.security.generate_password_hash)), by default (in my configuration) it is pbkdf2:sha256 with 16 bytes salt and 260,000 iterations.

You can generate it with Python (just make sure you have activated the environment where Flask is installed):

```
python -c 'from getpass import getpass; from werkzeug.security import generate_password_hash; print(generate_password_hash(getpass()))'

```

## Azure Active Directory authentication

WARP supports authentication against an Azure AD application.

To enable Azure AD auth, you need to set `AUTH_AAD` to `True` and at least configure `AAD_TENANT`, `AAD_CLIENT_ID` and `AAD_CLIENT_SECRET`.

This plugin supports:
- automatic Warp user creation on the first login, user name update on each login
- replicating user name and user groups from Azure AD groups.

### Configuration variables

Please note that every variable can be set either in the config file or via the environment (in that case, it needs to be prefixed by `WARP_` string).

|variable:|`AUTH_AAD`|
|:---|:---|
|type:|`boolean`|
|default value:|`False`|
|description:|If set to `True` enables Azure AD authentication|

|variable:|`AAD_TENANT`|
|:---|:---|
|type:|`string`|
|default value:|`None` (have to be defined)|
|description:|Azure tenant id |

|variable:|`AAD_CLIENT_ID`|
|:---|:---|
|type:|`string`|
|default value:|`None` (have to be defined)|
|description:|Azure Application (client) ID|

|variable:|`AAD_CLIENT_SECRET`|
|:---|:---|
|type:|`string`|
|default value:|`None` (have to be defined)|
|description:|Azure application token|

|variable:|`AAD_HTTPS_SCHEME`|
|:---|:---|
|type:|`string`: `https` or `http`|
|default value:|`https`|
|description:|If Azure AD callback URL should be over HTTPS|

|variable:|`AAD_USER_NAME_ATTRIBUTE`|
|:---|:---|
|type:|`string`|
|default value:|`name`|
|description:|Full user name attribute in claims|

|variable:|`AAD_LOGIN_ATTRIBUTE`|
|:---|:---|
|type:|`string`|
|default value:|`preferred_username`|
|description:|Login attribute in claims|

|variable:|`AAD_GROUP_MAP`|
|:---|:---|
|type:|`array` of `tuples`|
|default value:|`[ [null,null] ]`|
|description:|Works like the LDAP part, see [LDAP group mapping section.](#LDAP-group-mapping)|

|variable:|`AAD_GROUP_STRICT_MAPPING`|
|:---|:---|
|type:|`boolean`|
|default value:|`False`|
|description:|Should user be removed from Warp groups if such mapping is not present in AAD.<br>Works like the LDAP part, see [LDAP group mapping section](#LDAP-group-mapping) for more details.|


# Other

## How can I support you

Oh.. I was not expecting that, but you can send a beer via PayPal: https://paypal.me/sebo271

### Can I pay for a feature or support

Reach me out on my mail (git log is your friend), and we can discuss.
