#!/usr/bin/env python3
"""Validate i18n translation files for key consistency.

The app loads one JSON locale file at runtime (warp/static/i18n/<lang>.json) and
looks phrases up by their English key, falling back to en.json. So every locale
must define exactly the same set of keys as the reference locale (en):

  * MISSING keys  -> the user sees the raw English fallback (or the key itself).
  * EXTRA keys    -> a translation nobody ever looks up (dead weight, usually a
                     phrase mistakenly keyed by its own translated text).

This script flattens the nested ``phrases`` structure (and the rest of the file)
to dotted leaf paths the way node-polyglot does, then diffs every locale against
the reference. Exits non-zero if any locale is inconsistent, so it can run in CI.

Usage:
    python3 res/check_i18n.py            # check all locales against en
    python3 res/check_i18n.py --reference de
    python3 res/check_i18n.py --dir path/to/i18n
"""
import argparse
import json
import os
import sys

DEFAULT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'warp', 'static', 'i18n',
)


def flatten(value, prefix=''):
    """Flatten nested dicts to dotted leaf paths (lists/scalars are leaves)."""
    out = {}
    if isinstance(value, dict):
        for k, v in value.items():
            out.update(flatten(v, f'{prefix}{k}.'))
    else:
        out[prefix[:-1]] = value  # strip trailing '.'
    return out


def load_locales(i18n_dir):
    locales = {}
    for name in sorted(os.listdir(i18n_dir)):
        if not name.endswith('.json'):
            continue
        lang = name[:-len('.json')]
        with open(os.path.join(i18n_dir, name), encoding='utf-8') as f:
            locales[lang] = flatten(json.load(f))
    return locales


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dir', default=DEFAULT_DIR,
                    help='directory holding <lang>.json files (default: warp/static/i18n)')
    ap.add_argument('--reference', default='en',
                    help='reference locale every other locale must match (default: en)')
    args = ap.parse_args()

    if not os.path.isdir(args.dir):
        print(f'error: i18n dir not found: {args.dir}', file=sys.stderr)
        return 2

    locales = load_locales(args.dir)
    if args.reference not in locales:
        print(f'error: reference locale {args.reference!r} not found in {args.dir}',
              file=sys.stderr)
        return 2

    ref_keys = set(locales[args.reference])
    print(f'Reference: {args.reference} ({len(ref_keys)} keys)')

    ok = True
    for lang in sorted(locales):
        if lang == args.reference:
            continue
        keys = set(locales[lang])
        missing = sorted(ref_keys - keys)
        extra = sorted(keys - ref_keys)
        if not missing and not extra:
            print(f'  OK   {lang}: {len(keys)} keys')
            continue
        ok = False
        print(f'  FAIL {lang}: {len(keys)} keys '
              f'({len(missing)} missing, {len(extra)} extra/unused)')
        for k in missing:
            print(f'         - missing: {k!r}')
        for k in extra:
            print(f'         + extra/unused: {k!r}')

    print('\nAll locales consistent.' if ok
          else '\nInconsistencies found (see above).')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
