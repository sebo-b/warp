# Unit tests for warp.auth_saml.samlGetUserMetadata
#
# These tests exercise the attribute → metadata mapping logic (group access control,
# open access, unconditional groups, deny, NameID vs attribute login, list-valued
# attributes) without a running Flask app or IdP.
#
# Run with:  python -m pytest tests/  (from the repo root)

import pytest


def _make_app(**overrides):
    """Create a minimal Flask app with the given SAML config overrides."""
    import flask
    app = flask.Flask(__name__)
    app.config.update({
        'SAML_LOGIN_ATTRIBUTE': '',
        'SAML_USER_NAME_ATTRIBUTE': 'cn',
        'SAML_GROUPS_ATTRIBUTE': 'groups',
        'SAML_GROUP_MAP': [[None, None]],   # open access by default
    })
    app.config.update(overrides)
    return app


# ---------------------------------------------------------------------------
# Group-map semantics (mirrors test_oidc_metadata.py)
# ---------------------------------------------------------------------------

def test_open_access_null_null():
    """[null, null] allows any user regardless of groups."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[[None, None]])
    with app.test_request_context():
        result = samlGetUserMetadata('alice', {'cn': ['Alice']})
    assert result is not None
    assert result['login'] == 'alice'
    assert result['userName'] == 'Alice'
    assert result['groups'] == []


def test_conditional_group_deny():
    """User not in any listed group is denied."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[['admins', None]])
    with app.test_request_context():
        result = samlGetUserMetadata('bob', {'cn': ['Bob'], 'groups': ['users']})
    assert result is None


def test_conditional_group_allow():
    """User in a listed group is allowed and gets the mapped WARP group."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[['admins', 'WARP-Admins']])
    with app.test_request_context():
        result = samlGetUserMetadata('carol', {'cn': ['Carol'], 'groups': ['admins']})
    assert result is not None
    assert result['login'] == 'carol'
    assert result['groups'] == ['WARP-Admins']


def test_conditional_group_no_warp_group():
    """Mapped group with null WARP group grants access but adds no groups."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[['admins', None]])
    with app.test_request_context():
        result = samlGetUserMetadata('dave', {'cn': ['Dave'], 'groups': ['admins']})
    assert result is not None
    assert result['groups'] == []


def test_unconditional_group():
    """[null, 'WARP-Group'] always adds the WARP group, but does not grant access alone."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[[None, 'Everyone']])
    with app.test_request_context():
        result = samlGetUserMetadata('eve', {'cn': ['Eve'], 'groups': []})
    assert result is None  # no access-granting entry


def test_unconditional_group_with_access():
    """Unconditional group + access-granting entry."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[['admins', None], [None, 'Everyone']])
    with app.test_request_context():
        result = samlGetUserMetadata('frank', {'cn': ['Frank'], 'groups': ['admins']})
    assert result is not None
    assert result['groups'] == ['Everyone']


def test_open_access_plus_groups():
    """[null, null] + conditional groups: open access + group sync."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[[None, None], ['devs', 'Developers']])
    with app.test_request_context():
        result = samlGetUserMetadata('grace', {'cn': ['Grace'], 'groups': ['devs']})
    assert result is not None
    assert result['groups'] == ['Developers']


# ---------------------------------------------------------------------------
# SAML-specific: login attribute / NameID
# ---------------------------------------------------------------------------

def test_login_from_nameid():
    """When SAML_LOGIN_ATTRIBUTE is empty, NameID is used as login."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_LOGIN_ATTRIBUTE='')
    with app.test_request_context():
        result = samlGetUserMetadata('heidi', {'cn': ['Heidi']})
    assert result is not None
    assert result['login'] == 'heidi'


def test_login_from_attribute():
    """When SAML_LOGIN_ATTRIBUTE is set, the attribute value is used as login."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_LOGIN_ATTRIBUTE='email')
    with app.test_request_context():
        result = samlGetUserMetadata('unused-nameid', {
            'email': ['ivan@example.org'],
            'cn': ['Ivan'],
            'groups': [],
        })
    assert result is not None
    assert result['login'] == 'ivan@example.org'


def test_login_attribute_empty_list():
    """When the login attribute exists but is empty, fallback behaviour."""
    from warp.auth_saml import samlGetUserMetadata
    # When login attribute is set but the attribute is missing → None (deny)
    app = _make_app(SAML_LOGIN_ATTRIBUTE='email')
    with app.test_request_context():
        result = samlGetUserMetadata('unused-nameid', {
            'cn': ['Judy'],
        })
    assert result is None  # _firstAttr returns None → login is None → deny


# ---------------------------------------------------------------------------
# SAML-specific: list-valued attributes
# ---------------------------------------------------------------------------

def test_list_valued_name_attribute():
    """python3-saml returns attributes as lists; _firstAttr takes the first value."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app()
    with app.test_request_context():
        result = samlGetUserMetadata('karl', {'cn': ['Karl Heinz']})
    assert result is not None
    assert result['userName'] == 'Karl Heinz'


def test_name_fallback_to_login():
    """When name attribute is missing, login is used as userName."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app()
    with app.test_request_context():
        result = samlGetUserMetadata('leon', {})
    assert result is not None
    assert result['userName'] == 'leon'


def test_missing_nameid():
    """Missing NameID (and no login attribute) returns None."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_LOGIN_ATTRIBUTE='')
    with app.test_request_context():
        result = samlGetUserMetadata(None, {'cn': ['Mallory']})
    assert result is None


def test_missing_nameid_with_login_attr():
    """When NameID is None but login attribute is set, use the attribute."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_LOGIN_ATTRIBUTE='uid')
    with app.test_request_context():
        result = samlGetUserMetadata(None, {
            'uid': ['nancy'],
            'cn': ['Nancy'],
        })
    assert result is not None
    assert result['login'] == 'nancy'


# ---------------------------------------------------------------------------
# SAML-specific: groups attribute
# ---------------------------------------------------------------------------

def test_groups_attribute_missing():
    """Missing groups attribute is treated as empty list."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[['admins', None]])
    with app.test_request_context():
        result = samlGetUserMetadata('olivia', {'cn': ['Olivia']})
    assert result is None  # not in admins, denied


def test_groups_attribute_none():
    """Groups attribute that is None is treated as empty list."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUP_MAP=[[None, None]])
    with app.test_request_context():
        result = samlGetUserMetadata('peter', {'cn': ['Peter'], 'groups': None})
    assert result is not None
    assert result['groups'] == []


def test_custom_groups_attribute():
    """Custom SAML_GROUPS_ATTRIBUTE is respected (e.g. memberOf)."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_GROUPS_ATTRIBUTE='memberOf',
                    SAML_GROUP_MAP=[['warp-users', 'Users']])
    with app.test_request_context():
        result = samlGetUserMetadata('quinn', {
            'cn': ['Quinn'],
            'memberOf': ['warp-users', 'other-group'],
        })
    assert result is not None
    assert result['groups'] == ['Users']


# ---------------------------------------------------------------------------
# SAML-specific: empty NameID with empty login attribute
# ---------------------------------------------------------------------------

def test_empty_string_nameid():
    """Empty string NameID (with empty login attribute) returns None."""
    from warp.auth_saml import samlGetUserMetadata
    app = _make_app(SAML_LOGIN_ATTRIBUTE='')
    with app.test_request_context():
        result = samlGetUserMetadata('', {'cn': ['Ruth']})
    assert result is None
