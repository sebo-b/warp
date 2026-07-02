'use strict';

// Shared field-error helpers used by every admin edit dialog
// (users/groups/zones/plans): the "show/clear the inline error row" pair that
// every showEditDialog repeats after a failed save. Kept here as the one
// place that owns the error-row display contract so the markup stays
// consistent.
//
// (The wider "open a form dialog and resolve with the user's action" wrapper
// this module originally shipped was never adopted — every view kept its own
// showEditDialog with view-specific field wiring — so it was dead code and has
// been removed rather than left as scaffolding.)

export function showFieldError(errorDiv, errorMsg, text) {
  errorMsg.innerText = text;
  errorDiv.style.display = 'block';
}

export function clearFieldError(errorDiv, errorMsg) {
  errorDiv.style.display = 'none';
  errorMsg.innerText = '';
}

export default { showFieldError, clearFieldError };