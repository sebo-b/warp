# WARP logo sources

- `logo.svg` — landscape "WARP" wordmark (viewBox 390x85), same file as
  `warp/static/images/logo.svg`, which the app references via `<use #wordmark>`.
- `logo_sq.svg` — square-ish "W" mark (viewBox 118.1x85), cropped/cleaned from
  the wordmark; master for the PWA icons and iOS splash screens — regenerate
  those with `res/gen_pwa_assets.sh`.
- `Monoton-Regular.ttf` — the typeface the wordmark was set in (Monoton, by
  Vernon Adams), kept here so the logo can be re-typeset in the future.
  Licensed under the SIL Open Font License, see `OFL.txt`.

Both SVGs draw with `currentColor`, so they take the color of their CSS
context (the app tints the nav wordmark via `--warp-nav-logo-bg`).
