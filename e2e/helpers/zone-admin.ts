import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Ensure the first selectable calendar day is selected, return its timestamp.
 * The calendar grid exposes selectable days as .warp-cal-day cells with data-ts;
 * the first selectable one is today, pre-selected on load. A plain click is a
 * TOGGLE, so this only clicks when the day isn't already selected (avoids
 * accidentally deselecting the default-day and leaving no dates selected).
 */
export async function pickFirstDate(page: Page): Promise<number> {
  const cell = page.locator('.warp-cal-day[data-ts]:not(.is-disabled)').first();
  const ts = Number(await cell.getAttribute('data-ts'));
  if (!await cell.evaluate(el => el.classList.contains('is-selected')))
    await cell.click();
  return ts;
}

/**
 * Open the zone-admin seat-edit modal from the seat action bottom-sheet.
 * Requires the action modal to already be open for the clicked seat.
 */
export async function openSeatEditModal(page: Page): Promise<void> {
  await page.locator('.plan_action_btn[data-action="seat-edit"]').click();
  await expect(page.locator('#seat_edit_modal')).toHaveClass(/open/);
}

/**
 * Set the "Seat enabled" toggle in the seat-edit modal to `enabled` and Save.
 * The Materialize switch hides the native checkbox off-screen, so we toggle by
 * clicking the visible `.lever` (which the wrapping <label> maps to the input)
 * and read state back from the checkbox. Waits for the /xhr/plan/apply
 * response only when the toggle actually changes (an unchanged Save sends no
 * request).
 */
export async function setSeatEnabledAndSave(
  page: Page,
  enabled: boolean,
): Promise<void> {
  const checkbox = page.locator('#seat_edit_enabled');
  const lever = page.locator('#seat_edit_modal .switch .lever');
  const wasChecked = await checkbox.evaluate(
    (el) => (el as HTMLInputElement).checked,
  );
  const willApply = wasChecked !== enabled;
  if (willApply) {
    await lever.click();
  }

  const save = page.locator(
    '#seat_edit_modal .plan_action_btn[data-action="seat-edit-save"]',
  );
  if (willApply) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/xhr/plan/apply') && r.status() === 200),
      save.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);
  } else {
    await save.click();
  }
}