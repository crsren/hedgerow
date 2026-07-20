// Shared driving logic for the real OAuth login flow, used by every spec that
// needs a signed-in reader — see docs/local-testing.md's "OAuth locally" for
// why this works fully offline against the local PDS's own
// @atproto/oauth-provider.
import { expect, type Page } from "@playwright/test";

/**
 * Drive the full reader login: fill the reply box's handle input, submit,
 * complete the real password + consent screens on the local PDS's own
 * `@atproto/oauth-provider`, and land back on the post page. Asserts the
 * signed-in state is visible before returning.
 *
 * `slugPattern` is what to wait for in the post-redirect URL — a plain slug
 * string works for `page.waitForURL(new RegExp(...))`.
 */
export async function logIn(page: Page, handle: string, password: string, slugPattern: string): Promise<void> {
  const handleInput = page.getByPlaceholder("your-handle.bsky.social");
  await handleInput.fill(handle);

  await Promise.all([
    page.waitForURL(/\/oauth\/authorize/, { timeout: 15_000 }),
    page.getByRole("button", { name: /^log in with bluesky$/i }).click(),
  ]);

  // The real @atproto/oauth-provider-ui "Sign in" screen — identifier is
  // already pre-filled/locked from the authorize request, just the password.
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Consent screen (same URL, a client-side transition — no navigation to
  // wait for here). Public clients always get this screen; see
  // docs/local-testing.md / packages/reader/README.md's Consent section.
  await page.getByRole("button", { name: "Authorize" }).click();

  // Back on the post page, now with the fragment-carried OAuth callback
  // (#state=...&iss=...&code=...) for reader.restore()'s client.init() to
  // complete client-side.
  await page.waitForURL(new RegExp(slugPattern), { timeout: 15_000 });
  await expect(page.getByText(/^Replying as/)).toBeVisible({ timeout: 10_000 });
}
