'use strict';

import { M } from '../app/materialize.js';

// Destroy-then-init a Materialize FormSelect — the "there is no (exposed) API
// to just re-select an option" dance repeated at 8+ call sites across every
// modal form. Idempotent: safe to call on an already-initialized <select>.
export function initFormSelect(el, options) {
  var inst = M.FormSelect.getInstance(el);
  if (inst) inst.destroy();
  return M.FormSelect.init(el, options);
}

export default initFormSelect;
