import type { Page, APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';

/** Minimal Tabulator POST body accepted by all list endpoints. */
export const TAB = { page: 1, size: 100, sort: [], filter: [] };

/** POST to an admin XHR endpoint using the current session. */
export async function adminPost(
  page: Page,
  path: string,
  body: object,
): Promise<APIResponse> {
  return page.request.post(path, {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Create a throwaway user via the admin API. */
export async function createUser(
  page: Page,
  login: string,
  name = 'Test User',
  accountType = 20,
  password = 'testpassword',
): Promise<void> {
  const resp = await adminPost(page, '/xhr/users/edit', {
    action: 'add',
    login,
    name,
    account_type: accountType,
    password,
  });
  expect(resp.status()).toBe(200);
}
