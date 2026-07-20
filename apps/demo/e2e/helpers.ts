// Shared OAuth login drivers for e2e specs — drive the actual "Log in with
// Bluesky" UI (handle input + button) through the real local
// @atproto/oauth-provider password + consent screens. See
// docs/local-testing.md's "OAuth locally" for why this works fully offline.
//
// Two entry points, one flow:
//  - logInWithBluesky(): the shared steps up to (and including) consent.
//    Asserts nothing post-redirect — every page that mounts this login form
//    shows something different once signed in (the reply composer vs. the
//    /edit document list), so callers assert that part themselves. Used
//    directly by edit.spec.ts (whose /edit sign-in form is unaffected by the
//    auth-on-demand redesign — it's still visible up front, not gated behind
//    a modal) — AND by the reader specs below, where the SAME placeholder/
//    button text now lives inside AuthGateDialog's `.hedgerow-auth-dialog`
//    modal instead of an always-visible inline form. Playwright's locators
//    auto-wait, so this works unmodified either way as long as the modal has
//    already been opened (a gated submit/like) before calling it.
//  - logIn(): logInWithBluesky() + waits for the post-page redirect and the
//    reply box's signed-in state. Used by the reader specs
//    (oauth-reply.spec.ts, late-signup-reply.spec.ts) for a flow that's
//    ALREADY triggered the auth gate itself (a real submit/like) and wants
//    the shared post-redirect assertion too.
import { expect, type Page } from "@playwright/test";

/**
 * Fill the handle input, click "Log in with Bluesky", complete the real
 * password + consent screens on the local PDS's own oauth-provider, and let
 * the redirect back begin. Does NOT assert anything post-redirect.
 */
export async function logInWithBluesky(page: Page, handle: string, password: string): Promise<void> {
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
}

/**
 * Full reader login for the comment-box specs: the shared flow above, then
 * wait for the redirect back to the post page (`slugPattern` for
 * `page.waitForURL`) and assert the reply box shows its signed-in state.
 */
export async function logIn(page: Page, handle: string, password: string, slugPattern: string): Promise<void> {
  await logInWithBluesky(page, handle, password);

  // Back on the post page, now with the fragment-carried OAuth callback
  // (#state=...&iss=...&code=...) for reader.restore()'s client.init() to
  // complete client-side.
  await page.waitForURL(new RegExp(slugPattern), { timeout: 15_000 });
  await expect(page.getByText(/^Replying as/)).toBeVisible({ timeout: 10_000 });
}

/**
 * Scroll the comments island into view, retrying on detachment. The island
 * re-renders right after hydration when an SSR thread snapshot revalidates
 * (SLIMS-69's RevalidateOnMount) — a plain scrollIntoViewIfNeeded() can catch
 * the node mid-replacement and throw "Element is not attached to the DOM".
 */
export async function scrollToComments(page: Page, selector = "section.hedgerow"): Promise<void> {
  await expect(async () => {
    await page.locator(selector).scrollIntoViewIfNeeded();
  }).toPass({ timeout: 10_000 });
}

/**
 * Get a signed-in session on the post page via the auth-gate modal, for specs
 * that need to already be logged in to test something DOWNSTREAM of that (an
 * ordinary reply post, a like toggle, nested replies) rather than the gate/
 * redirect round trip itself — auth-gate.spec.ts is where that round trip is
 * exercised in depth.
 *
 * Deliberately triggers the gate via a REPLY submit, not a Like click: a
 * pending "like" intent auto-applies the moment the reader lands back signed
 * in (point 3 of the redesign), which would leave the post already liked
 * before a like/unlike test even starts. A reply intent is never
 * auto-posted, so this leaves post/comment state untouched — only the
 * composer ends up with a leftover draft (the trigger text), which is
 * cleared before returning so callers get a clean field.
 */
export async function signInViaAuthGate(
  page: Page,
  handle: string,
  password: string,
  slugPattern: string,
): Promise<void> {
  const field = page.getByPlaceholder("Write a reply…");
  await field.fill("(signing in)");
  await page
    .locator(".hedgerow-reply-box")
    .getByRole("button", { name: /^reply$/i })
    .click();
  await expect(page.locator(".hedgerow-auth-dialog")).toBeVisible();

  await logIn(page, handle, password, slugPattern);

  // The gate's own draft (the trigger text above) was restored into the
  // field per point 3 — clear it so the caller starts from an empty composer.
  await field.fill("");
}
