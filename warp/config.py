
# if DATABASE starts with "./" then app will look for db in the module root
DATABASE = './db.sqlite'
SECRET_KEY = b'change_me'

# use mellon (Apache SAML module) for authentication
#AUTH_MELLON = False
#MELLON_ENDPOINT = "/sp"

# after how many days force user to re-login (note that it is not a session timeout)
SESSION_LIFETIME = 1
WEEKS_IN_ADVANCE = 1
