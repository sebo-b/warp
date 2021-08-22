# WARP: Workspace Autonomous Reservation Program

The story of this project begins when, due to COVID-19, we have converted our regular office into a hybrid of regular and hot-desk assignments. We needed to find a solution for desks reservations, transparency of that, and detailed logging of who were in the office for epidemic purposes.

I've quickly evaluated a couple of existing solutions, but they were either too big and complicated and/or too expensive. As I assumed that other people would have the same challenge I had, I decided to spend my after-hours time making an open-source tailored system for the need. Yes - it is free as speech, not as beer.

## What WARP can do
- It allows people to book / change / unbook desks (or even parking stalls) in the office.
- It allows people to check who else will be in the office.
- It works on mobile.
- All is done in an easy, visual way.

## More advanced features
- Seats can be limited to certain people, so other people cannot book them (it is called assigned seats).
- Seats can be disabled, so people don't see them at all.
- Multiple zones (maps) can be created, for example, floors or parking.
- Zones can be grouped. One person can have only one seat booked simultaneously in a zone group (so you can have one group for floors and another group for parking stalls).
- Admin(s) can book / modify / unbook seat for any user.
If you are using SAML2.0 for SSO, it can be integrated via Apache [mod_auth_mellon](https://github.com/latchset/mod_auth_mellon) module.

## What's not done yet
- [WIP] User management, for now, if you don't use SAML/SSO SQL is your best friend for that.
- Map/zone management - new zones have to be created directly in the database.
- Reporting - at some point, you probably need a report from past reservations. It is not there yet.
- Translations - it is now only in English (and texts are hardcoded).

## What I'm not even planning to do
- Approvals - the main goal of the system was to make it autonomous and management-free. So I don't plan to implement approval flows.
- Timezone support - the selected time is always in the same timezone as a zone. It works well and is simple. But in case someone would like to have a couple of zones in different timezones and keep the `one person one seat at a given time` rule across these timezones, this will fail.

## What browsers are supported
To be honest, I was not paying much attention to browser compatibility, neither was I extensively testing it on other browsers than Chrome and Firefox. Nevertheless, all modern browsers should be supported (definitely not IE).

## Is there any demo?

![demo animation](res/demo.gif)

I have also deployed a demo into Google App Engine. Keep in mind that it is running only on one instance (so no heavy load) and using an in-memory database (so it is cleared up every time the instance is downscaled). Don't be surprised if your bookings disappear after a couple of minutes of inactivity.

You can [access it here](https://smart-spark-323312.oa.r.appspot.com/).
Log in as either one of: `admin`, `user1`, `user2` or `user3`
Password is `password`

# Deployment

## What technologies are used
- [Python 3.x](https://www.python.org/)
- [Flask 2.0.x](https://flask.palletsprojects.com/en/2.0.x/)
- [Sqlite](https://www.sqlite.org)
- [Materialize CSS](https://materializecss.com)
- a lot of JavaScript

## Quickstart

You need a working Python3 environment, and I won't cover it here.

From the command line:

```
# create virtual envirnoment and activate it
$ python3 -m venv .
$ source bin/activate

# install Warp with its dependencies
$ pip install -e git+https://github.com/sebo-b/warp.git#egg=warp

# create a database and populate it with sample data (the same as on demo site mentioned above)
$ FLASK_APP=warp flask init-db -s

# run a development server
$ FLASK_APP=warp flask run

# open http://127.0.0.1:5000/ in your web browser
```

## Production environment

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

### Webservers and WSGI

There is great documentation about various deployments options on [Flask webpage](https://flask.palletsprojects.com/en/2.0.x/deploying/index.html). I recommend reading that.

As a shortcut (if you know what you are doing), here is guinicorn command:
```
gunicorn "warp:create_app()"
```

and [mod_wsgi](https://modwsgi.readthedocs.io/) configuration:
```
# warp.wsgi file
from warp import create_app
application = create_app()

# Apache2 warp.conf

WSGIDaemonProcess warp python-home=/srv/warp user=warp group=warp threads=5
WSGIProcessGroup warp
WSGIApplicationGroup %{GLOBAL}

WSGIScriptAlias / /srv/warp/warp.wsgi

<Directory /srv/warp>
        Require all granted
</Directory>

Alias /static/ /srv/warp/src/warp/warp/static/
<Directory /srv/warp/src/warp/warp/static>
        Options -Indexes
        Require all granted
</Directory>
```

### How to configure maps and zones

There is no UI for it yet. So SQL is your best friend. Look at tables `zone` and `seat` in `warp/sql/schema.sql` and `warp/sql/sample_data.sql.` Note that seat (x,y) coordinates are not the center of the seat. It is the top-left corner of the seat sprite, which is 48x48.

### How to add / manage users

Again, no UI for it yet. Basically insert users to `user` table, look at table definition in `warp/sql/schema.sql.`

The role is one of:
```
0 - admin
1 - manager - currently the same as admin
2 - regular user
3 - viewer (read-only) - not really implemented
100 - account blocked
```

Password is a hash used by `werkzeug.security.check_password_hash` (more documentation can be [found here](https://werkzeug.palletsprojects.com/en/2.0.x/utils/#werkzeug.security.generate_password_hash)), by default (in my configuration) it is pbkdf2:sha256 with 16 bytes salt and 260,000 iterations. 

You can generate it with Python (just make sure you have activated the environment where Flask is installed):
```
python -c 'from getpass import getpass; from werkzeug.security import generate_password_hash; print(generate_password_hash(getpass()))'

```

## How can I support you

Oh.. I was not expecting that, but you can send a beer via paypal: https://paypal.me/sebo271

### Can I pay for a feature or support

Reach me out on my mail (git log is your friend), we can discuss.
