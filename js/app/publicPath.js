'use strict';

// Runtime publicPath (mount-prefix-safe: honors url_for's SCRIPT_NAME/prefix).
// Must be the very first thing that runs in the app entry — before any other
// import triggers a dynamic chunk load — hence its own side-effect-only module,
// imported first in main.js.
if (!window?.warpGlobals?.URLs?.distBase)
  throw Error('warpGlobals.URLs.distBase must be defined');

__webpack_public_path__ = window.warpGlobals.URLs.distBase;
