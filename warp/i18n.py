"""Language selection: per-user UI language with a cookie carry.

Metadata (endonym + flag) lives in each locale file's top-level ``name``/
``flag`` fields (decision: adding a language = one JSON file + one flag + one
code in ``LANGUAGES``, no code change). This module owns:

  * ``init_app`` — the startup validation: every code in ``LANGUAGES`` must
    have a parseable ``i18n/<code>.json`` with non-empty ``locale``/``name``/
    ``flag`` and an existing flag SVG, and ``DEFAULT_LANGUAGE`` must be in
    ``LANGUAGES``. A failure aborts startup — never silently vanish a language
    from menus. The parsed metadata is cached on the app.
  * ``resolve`` — the **pure** precedence rule (prefs > cookie > default for
    logged-in, cookie > default otherwise), shared by the render path and the
    bootstrap sync so the rule is not duplicated.
  * ``resolve_language_for_request`` — the context-processor entry point.
    Reads the ``warp_lang`` cookie and, **whenever ``flask.g`` has a login,
    ALWAYS reads ``user_prefs.language``** (one indexed PK lookup) — a valid
    cookie must NOT short-circuit that read, otherwise a stale cookie on a
    second device would paint the wrong language for the whole session
    (bootstrap only corrects the cookie, no reload). Per-render, intentional.
  * ``language_menu`` — the sorted flag+name list both templates and JS use.
"""
import json
import os

import flask

# Caches: code -> {"name", "flag", "language_label"} (from phrases.Language).
# Stored on app.extensions['warp_i18n']; the flag dir is resolved off the app.
_EXTENSION_KEY = 'warp_i18n'


def _static_dir(app):
    return app.static_folder


def _load_meta(app, code):
    """Parse one locale file into metadata, or raise ValueError."""
    sdir = _static_dir(app)
    path = os.path.join(sdir, 'i18n', f'{code}.json')
    if not os.path.isfile(path):
        raise ValueError(f'LANGUAGES: no locale file for {code!r} ({path})')
    with open(path, encoding='utf-8') as f:
        data = json.load(f)

    locale = data.get('locale')
    name = data.get('name')
    flag = data.get('flag')
    if not locale or not isinstance(locale, str):
        raise ValueError(f'{path}: missing/empty top-level "locale"')
    if not name or not isinstance(name, str):
        raise ValueError(f'{path}: missing/empty top-level "name" (endonym)')
    if not flag or not isinstance(flag, str):
        raise ValueError(f'{path}: missing/empty top-level "flag" (svg filename)')

    flag_path = os.path.join(sdir, 'images', 'flags', flag)
    if not os.path.isfile(flag_path):
        raise ValueError(f'{path}: flag image not found: images/flags/{flag}')

    phrases = data.get('phrases') or {}
    language_label = phrases.get('Language', code)

    return {'name': name, 'flag': flag, 'language_label': language_label}


def init_app(app):
    """Validate language config and cache locale metadata on the app.

    Called from ``create_app`` after ``initConfig``. Raises on any bad config
    so a misconfigured deployment fails loudly at boot, never silently."""
    languages = app.config.get('LANGUAGES') or []
    default = app.config.get('DEFAULT_LANGUAGE')

    if not isinstance(languages, list) or not languages:
        raise ValueError('LANGUAGES must be a non-empty JSON array of locale codes')
    if not default or not isinstance(default, str):
        raise ValueError('DEFAULT_LANGUAGE must be set to a locale code')
    if default not in languages:
        raise ValueError(f'DEFAULT_LANGUAGE {default!r} is not listed in LANGUAGES {languages!r}')

    meta = {}
    for code in languages:
        if not isinstance(code, str):
            raise ValueError(f'LANGUAGES entries must be strings, got {code!r}')
        meta[code] = _load_meta(app, code)

    app.extensions[_EXTENSION_KEY] = meta


def _meta():
    return flask.current_app.extensions[_EXTENSION_KEY]


def configured_languages():
    """Configured codes, sorted by endonym ``name`` (→ de,en,es,fr,pl)."""
    meta = _meta()
    return sorted(meta.keys(), key=lambda c: meta[c]['name'])


def resolve(cookie_value, pref_value, default):
    """Pure precedence rule, no I/O.

    ``pref_value`` non-NULL and configured → prefs win (logged-in).
    Else ``cookie_value`` configured → cookie (login page / no prefs).
    Else ``default``.
    """
    configured = set(configured_languages())
    if pref_value is not None and pref_value in configured:
        return pref_value
    if cookie_value is not None and cookie_value in configured:
        return cookie_value
    return default


def language_menu(active):
    """List of {code, name, flag, active} sorted by endonym, for templates/JS."""
    meta = _meta()
    out = []
    for code in configured_languages():
        m = meta[code]
        out.append({'code': code, 'name': m['name'], 'flag': m['flag'],
                    'active': code == active})
    return out


def user_language(login):
    """user_prefs.language for login, or None (no row / NULL). Imported lazily
    so this module stays importable before the DB is bound (config-time)."""
    from warp.db import UserPrefs
    row = UserPrefs.select(UserPrefs.language).where(UserPrefs.login == login).first()
    if row is None:
        return None
    return row['language']


def resolve_language_for_request():
    """Context-processor entry point. Returns (active_code, languages_menu).

    Per-render. iCal action pages set flask.g.ical_owner_login so the page
    chrome (<html lang>, i18nUrl) matches the card text — owner pref, cookie
    ignored (plan §15.11). Otherwise reads the warp_lang cookie and, whenever
    flask.g has a login, ALWAYS reads user_prefs.language (one indexed PK lookup)
    — a valid cookie must NOT skip that read (see module docstring). Memoized on
    flask.g for one request."""
    cached = getattr(flask.g, '_warp_lang_resolved', None)
    if cached is not None:
        return cached

    default = flask.current_app.config['DEFAULT_LANGUAGE']
    owner = getattr(flask.g, 'ical_owner_login', None)
    if owner is not None:
        # iCal action page chrome: owner pref wins, cookie ignored.
        active = resolve(None, user_language(owner), default)
    else:
        cookie = flask.request.cookies.get('warp_lang')
        login = getattr(flask.g, 'login', None)
        pref = user_language(login) if login else None
        active = resolve(cookie, pref, default)

    menu = language_menu(active)

    result = (active, menu)
    flask.g._warp_lang_resolved = result
    return result


def lang_aria_for(active):
    """The login dropdown's aria-label/title — server-rendered (not a .TR
    attribute) from the active language's cached ``Language`` phrase."""
    meta = _meta()
    return meta.get(active, {}).get('language_label', active)