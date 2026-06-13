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

## Demo quickstart

The preferred way to deploy is to run it via Docker. You need a working docker, and I won't cover it here.

### docker compose

From the command line:

```
# clone the repository
$ git clone https://github.com/sebo-b/warp.git
$ cd warp/containers

$ docker compose up
```

After that, open http://127.0.0.1:8080 in your browser and log in as `admin` with password `noneshallpass`.

See [`containers/`](containers/) for all container files and customisation options.

### without docker compose (but why?)

From the command line:

```
# clone the repository
$ git clone https://github.com/sebo-b/warp.git
$ cd warp

# build docker image (you can skip hash if you don't want to track it)
$ export GIT_HASH=`git log -1 --format=%h`
$ docker build -f containers/Dockerfile -t warp:latest -t warp:$GIT_HASH .

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

**Database Driver**: WARP uses the `psycopg3://` driver scheme (psycopg 3). Make sure your database URLs use this prefix.

```
WARP_DATABASE=psycopg3://user:password@hostname:5432/warp_db
```

For all configuration options — environment variables, database settings, secret key generation, language, and authentication providers (LDAP, Azure AD, SAML) — see [CONFIGURATION.md](CONFIGURATION.md).

# Testing

## Functionality guide

[FEATURES.md](FEATURES.md) describes everything a user, tester, or administrator
can do in WARP — authentication options, roles and zone types, booking rules,
calendar integration, and all configuration variables. It is the reference for
what behaviour is expected and is the basis for the end-to-end test suite.

## End-to-end tests

A browser-driven [Playwright](https://playwright.dev/) suite lives in
[`e2e/`](e2e/). It exercises the real UI against a self-contained container
built from `Dockerfile_debug` (PostgreSQL + flask in debug mode), with the
database reset to a pristine sample state before every test.

```sh
cd e2e
npm ci
npx playwright install chromium
npm test                 # builds + starts the container automatically (podman by default)
```

See [`e2e/README.md`](e2e/README.md) for how the harness works, useful
variants (headed mode, UI mode, single file), test accounts, and conventions
for writing new tests.


# Other

## How can I support you

Oh.. I was not expecting that, but you can send a beer via PayPal: https://paypal.me/sebo271

### Can I pay for a feature or support

Reach me out on my mail (git log is your friend), and we can discuss.
