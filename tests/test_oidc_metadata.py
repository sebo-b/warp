# Unit tests for warp.auth_oidc.oidcGetUserMetadata
#
# These tests exercise the claim → metadata mapping logic (group access control,
# open access, unconditional groups, deny) without a running Flask app or IdP.
#
# Run with:  python -m pytest tests/  (from the repo root)

import pytest

# We need a minimal Flask app context because oidcGetUserMetadata reads
# flask.current_app.config. Build one with a fixed config.

def _make_app(**overrides):
    """Create a minimal Flask app with the given OIDC config overrides."""
    import flask
    app = flask.Flask(__name__)
    app.config.update({
        'OIDC_LOGIN_ATTRIBUTE': 'preferred_username',
        'OIDC_USER_NAME_ATTRIBUTE': 'name',
        'OIDC_GROUPS_CLAIM': 'groups',
        'OIDC_GROUP_MAP': [[None, None]],   # open access by default
    })
    app.config.update(overrides)
    return app


def test_open_access_null_null():
    """[null, null] allows any user regardless of groups."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[[None, None]])
    with app.test_request_context():
        result = oidcGetUserMetadata({'preferred_username': 'alice', 'name': 'Alice'})
    assert result is not None
    assert result['login'] == 'alice'
    assert result['userName'] == 'Alice'
    assert result['groups'] == []


def test_conditional_group_deny():
    """User not in any listed group is denied."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[['admins', None]])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'bob',
            'name': 'Bob',
            'groups': ['users']
        })
    assert result is None


def test_conditional_group_allow():
    """User in a listed group is allowed and gets the mapped WARP group."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[['admins', 'WARP-Admins']])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'carol',
            'name': 'Carol',
            'groups': ['admins']
        })
    assert result is not None
    assert result['login'] == 'carol'
    assert result['groups'] == ['WARP-Admins']


def test_conditional_group_no_warp_group():
    """Mapped group with null WARP group grants access but adds no groups."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[['admins', None]])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'dave',
            'name': 'Dave',
            'groups': ['admins']
        })
    assert result is not None
    assert result['groups'] == []


def test_unconditional_group():
    """[null, 'WARP-Group'] always adds the WARP group, but does not grant access alone."""
    from warp.auth_oidc import oidcGetUserMetadata
    # Without an access-granting entry, unconditional groups alone deny
    app = _make_app(OIDC_GROUP_MAP=[[None, 'Everyone']])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'eve',
            'name': 'Eve',
            'groups': []
        })
    assert result is None  # no access-granting entry


def test_unconditional_group_with_access():
    """Unconditional group + access-granting entry."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[['admins', None], [None, 'Everyone']])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'frank',
            'name': 'Frank',
            'groups': ['admins']
        })
    assert result is not None
    assert result['groups'] == ['Everyone']


def test_open_access_plus_groups():
    """[null, null] + conditional groups: open access + group sync."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[[None, None], ['devs', 'Developers']])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'grace',
            'name': 'Grace',
            'groups': ['devs']
        })
    assert result is not None
    assert result['groups'] == ['Developers']


def test_missing_login_claim():
    """Missing login claim returns None."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app()
    with app.test_request_context():
        result = oidcGetUserMetadata({'name': 'NoLogin'})
    assert result is None


def test_name_fallback_to_login():
    """When name claim is missing, login is used as userName."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app()
    with app.test_request_context():
        result = oidcGetUserMetadata({'preferred_username': 'heidi'})
    assert result is not None
    assert result['userName'] == 'heidi'


def test_custom_claims():
    """Custom claim attribute names are respected."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(
        OIDC_LOGIN_ATTRIBUTE='email',
        OIDC_USER_NAME_ATTRIBUTE='nickname',
        OIDC_GROUPS_CLAIM='roles',
    )
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'email': 'ivan@example.org',
            'nickname': 'Ivan',
            'roles': ['editor'],
        })
    assert result is not None
    assert result['login'] == 'ivan@example.org'
    assert result['userName'] == 'Ivan'


def test_groups_claim_missing():
    """Missing groups claim is treated as empty list."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[['admins', None]])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'judy',
            'name': 'Judy',
            # no 'groups' key at all
        })
    assert result is None  # not in admins, denied


def test_groups_claim_null():
    """groups claim that is null/None is treated as empty list."""
    from warp.auth_oidc import oidcGetUserMetadata
    app = _make_app(OIDC_GROUP_MAP=[[None, None]])
    with app.test_request_context():
        result = oidcGetUserMetadata({
            'preferred_username': 'karl',
            'name': 'Karl',
            'groups': None,
        })
    assert result is not None
    assert result['groups'] == []
