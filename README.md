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
- **Plans & Zones**: Plans hold the floor-map image and seats; zones control access. A plan can contain seats from multiple zones, enabling mixed-zone floor maps. Each seat is assigned to a specific zone (no plan-level default zone). The plan map editor shows a zone picker when adding seats and pre-selects the zone with the most seats on the plan the first time "Add seats" is used. Deleting a zone that contains seats shows a reassignment modal to move those seats to another zone or to delete the seats (and their booking history) with a red button that requires an additional confirmation. Deleting a zone with no seats shows a simple confirmation dialog.
- **Per-Zone Booking Constraint**: One seat per zone per time slot. Users can hold seats in different zones simultaneously (e.g., a desk in Zone A and a parking spot) but cannot double-book within the same zone.
- **Assigned Seats**: Limit seats to certain people so others cannot book them.
- **Disabled Seats**: Hide seats so people don't see them at all.
- **Auto-Book**: Use the floating "+" button to quickly book an available seat with one click.
- **Calendar Integration**: Subscribe to iCal feeds in Google Calendar, Outlook, Apple Calendar, or any other calendar app. The feed includes bookings and/or reminders; the URL can be filtered with `?type=bookings`, `?type=reminders` (or `all`, the default).
- **Per-Zone Reminders**: Configure automatic booking and seat-release reminder notifications for each zone independently.
- **Days-in-Advance Booking Window**: Per-assignment configurable limits on how far in advance users can book seats.
- **Virtual "Everyone" Access**: Seats and zones can be configured with virtual "everyone" access for flexible seat management.
- **Translations**: Currently supports English, German, French, Spanish, and Polish.
- **SAML 2.0**: Native SP via python3-saml (recommended) or legacy Apache mod_auth_mellon.
- **LDAP/Active Directory**: Via LDAP3 library.
- **Azure AD**: Via Microsoft Authentication Library (MSAL).
- **OIDC / OpenID Connect**: Generic SSO via any compliant identity provider (Authlib).

See [FEATURES.md](FEATURES.md) for a detailed description of all functionality, roles, booking rules, and configuration options.
New to the concepts? Start with the [GLOSSARY.md](GLOSSARY.md), and read
[PERMISSIONS.md](PERMISSIONS.md) for the complete access model (account types,
zones, plans, roles, and how they nest).

## What I'm not even planning to do

- Approvals - the main goal of the system was to make it autonomous and management-free. So I don't intend to implement approval flows.
- Timezone support - the selected time is always in the same timezone as a zone. It works well and is simple. But in case someone would like to have a couple of zones in different timezones and keep the `one person one seat at a given time` rule across these timezones, this will fail.

## What browsers are supported

To be honest, I was not paying much attention to browser compatibility, nor was I extensively testing it on other browsers than Chrome and Firefox. Nevertheless, all modern browsers should be supported (definitely not IE).

## Is there any demo?

![demo animation](res/demo.gif)

Or try it yourself in seconds — see [Quick start](#quick-start) below.

# Quick start

The fastest way to try WARP is with the all-in-one debug image — no database setup, no compose file, one command:

```sh
docker run --rm -p 5000:5000 ghcr.io/sebo-b/warp:debug
```

Then open http://127.0.0.1:5000 and log in. The demo is seeded with several accounts:

| Login                     | Password        | Role                                      |
| ------------------------- | --------------- | ----------------------------------------- |
| `admin`                   | `noneshallpass` | Administrator — full management UI        |
| `user1`, `user2`, `user3` | `password`      | Regular users — the everyday booking view |

> **Note:** `warp:debug` bundles PostgreSQL and Flask's development server in a single container with a hard-coded password and auto-reset state. It is intended for demos and local exploration only — see [Container images](#container-images) below.

# Container images

Two images are published to the GitHub Container Registry on every push to `main` and on version tags:

| Image                        | Based on                               | Purpose                                                               |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `ghcr.io/sebo-b/warp:latest` | Alpine + uWSGI                           | Production — no database bundled, configure via environment variables |
| `ghcr.io/sebo-b/warp:debug`  | Alpine + Flask dev server + PostgreSQL | Demo / e2e testing — self-contained, not for production               |

Version tags (`v1.2.3`) produce additional `warp:1.2.3` and `warp:1.2` tags on the production image. Both images are published for `linux/amd64` and `linux/arm64`.

See [`containers/README.md`](containers/README.md) for build instructions, all environment variables, Docker Compose, and Podman Quadlet deployment.

# Deployment

During the first run on an empty database, WARP will populate the database schema and create an admin user.

Default admin credentials are: `admin:noneshallpass`

## Upgrading

Schema migrations are applied automatically on startup. WARP tracks the current schema version in the database and applies any pending migration scripts from `warp/sql/` in order.

## Production environment

For production, run the `warp:latest` image behind a reverse proxy (nginx) with PostgreSQL on a separate host.

**Database connection**: WARP connects to PostgreSQL via discrete component settings (no URL):

```
WARP_DATABASE_ADDRESS=hostname:5432
WARP_DATABASE_NAME=warp_db
WARP_DATABASE_USER=user
WARP_DATABASE_PASSWORD=password
```

For all configuration options — environment variables, secret key generation, language, and authentication providers (LDAP, Azure AD, OIDC, SAML) — see [CONFIGURATION.md](CONFIGURATION.md).

For ready-to-use deployment examples (Docker Compose, Podman Quadlet with systemd) see [`containers/README.md`](containers/README.md).

# Development

You need a working Python 3 environment, Node.js, and PostgreSQL. This section is intended for contributors, not for running WARP in production.

```sh
# clone repo
$ git clone https://github.com/sebo-b/warp.git
$ cd warp

# create virtual environment and activate it
$ python3 -m venv --prompt warp .venv
$ source .venv/bin/activate

# install python requirements
$ pip install -r requirements.txt

# compile JavaScript files
$ pushd js
$ npm ci
$ npm run build
$ popd

# set database connection if different from the debug defaults
# (DevelopmentSettings already defaults to 127.0.0.1:5432, db=postgres,
# user=postgres, password=postgres_password)
# export WARP_DATABASE_ADDRESS=127.0.0.1:5432
# export WARP_DATABASE_NAME=postgres
# export WARP_DATABASE_USER=postgres
# export WARP_DATABASE_PASSWORD=postgres_password

# run the app
$ flask --app warp --debug run
```

After that, open http://127.0.0.1:5000 in your browser and log in with the default credentials.

# Testing

## Functionality guide

[FEATURES.md](FEATURES.md) describes everything a user, tester, or administrator
can do in WARP — authentication options, roles and zone types, booking rules,
calendar integration, and all configuration variables. It is the reference for
what behaviour is expected and is the basis for the end-to-end test suite.

## End-to-end tests

A browser-driven [Playwright](https://playwright.dev/) suite lives in
[`e2e/`](e2e/). It exercises the real UI against a self-contained container
built from `Dockerfile_debug` (PostgreSQL + Flask in debug mode), with the
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
