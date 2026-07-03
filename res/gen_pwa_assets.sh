#!/bin/sh
# Generate the PWA icons and iOS splash screens from the master logo artwork.
#
# One-time dev tool (not a runtime/build dependency) — outputs are checked into
# warp/static/images/. Re-run when the logo changes or when Apple ships a new
# iPhone screen size (see SPLASH_SIZES below; an unmatched device silently gets
# a plain white splash, nothing breaks).
#
# Requires: rsvg-convert (librsvg), magick (ImageMagick 7).
#
# The master (res/icons/logo_sq.svg) is the WARP W mark drawn with currentColor;
# it is rendered white — matching --warp-nav-logo-bg, the wordmark color on the
# landing page nav bar — and composited onto the brand primary #2C3E50
# (--warp-primary), the background_color/theme_color in the manifest.

set -eu

BG='#2C3E50'
FG='#ffffff'

RES_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$RES_DIR/icons/logo_sq.svg"
IMG_DIR="$RES_DIR/../warp/static/images"
SPLASH_DIR="$IMG_DIR/splash"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$SPLASH_DIR"

# Bake the foreground color in (the SVG uses currentColor, which rasterizers
# would render black).
sed "s/currentColor/$FG/g" "$SRC" > "$TMP/logo.svg"

# render_on_canvas <out.png> <canvas_w> <canvas_h> <logo_width_px>
render_on_canvas() {
    rsvg-convert -w "$4" "$TMP/logo.svg" -o "$TMP/mark.png"
    magick -size "$2x$3" "xc:$BG" "$TMP/mark.png" \
        -gravity center -composite "$1"
}

# Launcher icons: W mark (ratio 118.1:85) at 76% width. Maskable variant
# smaller so the mark's whole bounding box (diagonal!) stays inside the
# central-80% safe circle of Android launcher masks: diagonal <= 0.8*512
# gives width <= 410*118.1/sqrt(118.1^2+85^2) ~= 333.
render_on_canvas "$IMG_DIR/icon-192.png"          192 192 146
render_on_canvas "$IMG_DIR/icon-512.png"          512 512 390
render_on_canvas "$IMG_DIR/icon-512-maskable.png" 512 512 330

# iOS startup images (apple-touch-startup-image): iOS shows a splash ONLY when
# an image matches the device's point size x DPR exactly. Portrait iPhone set;
# keep in sync with the media-query list in warp/templates/pwa_splash.html
# (same triples, points x DPR).
#
# width_pt height_pt dpr — devices covered:
SPLASH_SIZES='
375 667 2   # SE 2/3, 6/7/8
414 896 2   # XR, 11
375 812 3   # X, XS, 11 Pro, 12/13 mini
390 844 3   # 12, 13, 14
393 852 3   # 14 Pro, 15, 16
402 874 3   # 16 Pro
414 896 3   # XS Max, 11 Pro Max
428 926 3   # 12/13 Pro Max, 14 Plus
430 932 3   # 14 Pro Max, 15/16 Plus, 15 Pro Max
440 956 3   # 16 Pro Max
'

# --- Consistency checks ------------------------------------------------------
# The splash size list and the brand color deliberately live in more than one
# place (each in its consumer's native format); this script is the point where
# drift becomes visible. Any mismatch aborts generation.

fail() { echo "CONSISTENCY ERROR: $*" >&2; exit 1; }

# 1. Splash triples here vs the media-query list in pwa_splash.html.
TPL="$RES_DIR/../warp/templates/pwa_splash.html"
ours="$(echo "$SPLASH_SIZES" | sed -e 's/#.*//' -e 's/  */ /g' -e 's/^ //' -e 's/ $//' | grep -v '^$' | sort)"
theirs="$(sed -n 's/^ *(\([0-9]*\), \([0-9]*\), \([0-9]*\)),$/\1 \2 \3/p' "$TPL" | sort)"
[ -n "$theirs" ] || fail "no (w, h, dpr) triples parsed from $TPL"
echo "$ours" > "$TMP/sizes.script"; echo "$theirs" > "$TMP/sizes.template"
[ "$ours" = "$theirs" ] || fail "splash sizes differ between this script and pwa_splash.html:
$(diff "$TMP/sizes.script" "$TMP/sizes.template" || true)"

# 2. BG here vs --warp-primary in theme.css, the manifest colors in view.py,
#    and the theme-color meta in base.html (4 hardcode sites, one check).
#    Note: this guards repo-internal drift only — a deployment re-branded at
#    runtime via WARP_THEME_FILE still ships the stock manifest/splash colors.
themeColor="$(sed -n 's/^ *--warp-primary: *\(#[0-9A-Fa-f]*\).*/\1/p' "$RES_DIR/../warp/static/theme.css" | head -1)"
[ "$themeColor" = "$BG" ] || fail "BG=$BG but theme.css --warp-primary=$themeColor"
grep -q "name=\"theme-color\" content=\"$BG\"" "$RES_DIR/../warp/templates/base.html" \
    || fail "base.html theme-color meta does not match BG=$BG"
[ "$(grep -c "_color': '$BG'" "$RES_DIR/../warp/view.py")" = 2 ] \
    || fail "view.py manifest background_color/theme_color do not both match BG=$BG"

# --- Generation ---------------------------------------------------------------

echo "$SPLASH_SIZES" | grep -v '^\s*$' | while read -r W H D _comment; do
    PW=$((W * D)); PH=$((H * D))
    # W mark at 45% of screen width, centered on the brand background.
    render_on_canvas "$SPLASH_DIR/splash-${PW}x${PH}.png" "$PW" "$PH" $((PW * 45 / 100))
done

echo "done: $(ls "$IMG_DIR"/icon-*.png "$SPLASH_DIR" | wc -l | tr -d ' ') files"
