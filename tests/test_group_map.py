# Unit tests for warp.auth.buildUserMetadata (shared group-map helper)
#
# This tests the extracted helper directly, independent of any particular
# SSO backend (OIDC, SAML, etc.).
#
# Run with:  python -m pytest tests/  (from the repo root)

import pytest

from warp.auth import buildUserMetadata


# ---------------------------------------------------------------------------
# Open access
# ---------------------------------------------------------------------------

def test_open_access_null_null():
    """[null, null] allows any user regardless of groups."""
    result = buildUserMetadata('alice', 'Alice', [], [[None, None]])
    assert result is not None
    assert result['login'] == 'alice'
    assert result['userName'] == 'Alice'
    assert result['groups'] == []


def test_open_access_with_no_idp_groups():
    """[null, null] + no IdP groups → open access, empty WARP groups."""
    result = buildUserMetadata('bob', 'Bob', None, [[None, None]])
    assert result is not None
    assert result['groups'] == []


# ---------------------------------------------------------------------------
# Conditional access
# ---------------------------------------------------------------------------

def test_conditional_deny():
    """User not in any listed group is denied."""
    result = buildUserMetadata('carol', 'Carol', ['users'], [['admins', None]])
    assert result is None


def test_conditional_allow_with_warp_group():
    """User in a listed group gets the mapped WARP group."""
    result = buildUserMetadata('dave', 'Dave', ['admins'], [['admins', 'WARP-Admins']])
    assert result is not None
    assert result['groups'] == ['WARP-Admins']


def test_conditional_allow_no_warp_group():
    """Mapped group with null WARP group grants access but adds no groups."""
    result = buildUserMetadata('eve', 'Eve', ['admins'], [['admins', None]])
    assert result is not None
    assert result['groups'] == []


def test_conditional_multiple_matches():
    """User in multiple listed groups gets all mapped WARP groups."""
    result = buildUserMetadata('frank', 'Frank', ['admins', 'devs'], [
        ['admins', 'WARP-Admins'],
        ['devs', 'Developers'],
    ])
    assert result is not None
    assert result['groups'] == ['WARP-Admins', 'Developers']


def test_conditional_some_matched_some_not():
    """Only matched IdP groups contribute WARP groups."""
    result = buildUserMetadata('grace', 'Grace', ['devs'], [
        ['admins', 'WARP-Admins'],
        ['devs', 'Developers'],
    ])
    assert result is not None
    assert result['groups'] == ['Developers']


# ---------------------------------------------------------------------------
# Unconditional groups
# ---------------------------------------------------------------------------

def test_unconditional_group_alone_denies():
    """[null, 'WARP-Group'] does not grant access alone."""
    result = buildUserMetadata('heidi', 'Heidi', [], [[None, 'Everyone']])
    assert result is None


def test_unconditional_group_with_access():
    """Unconditional group + access-granting entry."""
    result = buildUserMetadata('ivan', 'Ivan', ['admins'], [
        ['admins', None],
        [None, 'Everyone'],
    ])
    assert result is not None
    assert result['groups'] == ['Everyone']


# ---------------------------------------------------------------------------
# Mixed: open access + conditional
# ---------------------------------------------------------------------------

def test_open_access_plus_conditional():
    """[null, null] + conditional groups: open access + group sync."""
    result = buildUserMetadata('judy', 'Judy', ['devs'], [
        [None, None],
        ['devs', 'Developers'],
    ])
    assert result is not None
    assert result['groups'] == ['Developers']


def test_open_access_no_matching_conditional():
    """[null, null] + conditional: user not in any conditional group → open, no mapped groups."""
    result = buildUserMetadata('karl', 'Karl', [], [
        [None, None],
        ['devs', 'Developers'],
    ])
    assert result is not None
    assert result['groups'] == []


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_idp_groups_none():
    """idpGroups=None is treated as empty list."""
    result = buildUserMetadata('leon', 'Leon', None, [[None, None]])
    assert result is not None


def test_empty_group_map():
    """Empty group map denies everyone."""
    result = buildUserMetadata('mallory', 'Mallory', ['admins'], [])
    assert result is None


def test_multiple_unconditional_groups():
    """Multiple [null, 'WARP-Group'] entries without access entry → deny."""
    result = buildUserMetadata('nancy', 'Nancy', [], [
        [None, 'Group1'],
        [None, 'Group2'],
    ])
    assert result is None
