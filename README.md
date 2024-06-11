# Announcement

$${\color{red}looking\ for\ a\ maintainer}$$
Recently, I haven't had too much time to maintain this project. There are a couple of great PRs waiting for my review and merge, and I'm sad that I'm not able to do that. So, I'm looking for a maintainer for this project. If you are an experienced Python and JavaScript (full-stack) developer, I'll be more than happy to accept your help! Please reach out to me via email (available in git-log).

# WARP: Workspace Autonomous Reservation Program

The story of this project begins when, due to COVID-19, we have converted our regular office into a hybrid of regular and hot-desk assignments. We needed to find a solution for desk reservations, transparency of that, and detailed logging of who was in the office for epidemic purposes.

I've quickly evaluated a couple of existing solutions, but they were either too big and complicated and/or too expensive. As I assumed that other people would have the same challenge I had, I decided to spend my after-hours time making an open-source tailored system for the need. Yes - it is free as speech, not as beer.

## What WARP can do

- It allows people to book / change / unbook desks (or even parking stalls) in the office.
- It allows people to check who else will be in the office.
- It works on mobile.
- All is done in an easy, visual way.
- Generate a report of past bookings and export it to Excel file

## More advanced features

- Seats can be limited to certain people, so other people cannot book them (it is called assigned seats).
- Seats can be disabled, so people don't see them at all.
- Multiple zones (maps) can be created, for example, floors or parking.
- Zones can be grouped. One person can have only one seat booked simultaneously in a zone group (so you can have one group for floors and another group for parking stalls).
- Admin(s) can book / modify / unbook seat for any user.
- Full admin interface to add/remove/edit maps, zones, groups, and users.
- SAML2.0 support - via Apache [mod_auth_mellon](https://github.com/latchset/mod_auth_mellon) module.
- LDAP and Active Directory - via LDAP3 library.
- Translations - currently, English and Polish are supported.

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
> --env 'WARP_DATABASE=postgresql://postgres:postgres_password@warp-demo-db:5432/postgres' \
> --env WARP_SECRET_KEY=mysecretkey \
> --env WARP_DATABASE_INIT_SCRIPT='["sql/schema.sql","sql/sample_data.sql"]' \
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

# setup Flask and database URL
$ export FLASK_APP=warp
$ export FLASK_ENV=development
$ export WARP_DATABASE=postgresql://warp:warp@localhost:5432/warp

# run the app
$ flash run
```

After that, open http://127.0.0.1:5000 in your browser and log in as `admin` with password `noneshallpass`.

## Production environment

For the production environment, I recommend running Nginx and PostgreSQL on separate VMs. Then (even multiple) WARP image can be simply started via Docker and rev-proxed from Nginx.

Each configuration parameter (check config.py) can be passed via the envirnoment as `WARP_varname`.
As environment variables as passed as strings, they need to be parsed into Python types and data structures.
To do that values are first converted to lower case and then `json.loads` is used. If that fails variable is treaten as string.
This makes possible to pass integers, floats, booleans as well as dicts, arrays and None value (as JSON null).

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

# Other

## How can I support you

Oh.. I was not expecting that, but you can send a beer via PayPal: https://paypal.me/sebo271

### Can I pay for a feature or support

Reach me out on my mail (git log is your friend), and we can discuss.
