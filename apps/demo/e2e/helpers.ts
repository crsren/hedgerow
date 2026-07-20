// Shared OAuth login driver for e2e specs — drives the actual "Log in with
// Bluesky" UI (handle input + button) through the real local
// @atproto/oauth-provider password + consent screens. Both the reply box
// (CommentThread.tsx) and the /edit author sign-in (EditorIsland.tsx,
// SLIMS-64) reuse the SAME login UI pattern/selectors (see
// docs/local-testing.md's "OAuth locally" section for what this proves and
// oauth-reply.spec.ts's original comments for how the selectors were found —
// this file just factors the shared steps out so edit.spec.ts doesn't
// duplicate them).
import { type Page } from "@playwright/test";

/**
 * Fill the handle input, click "Log in with Bluesky", complete the real
 * password + consent screens on the local PDS's own oauth-provider, and wait
 * for the redirect back to land. Does NOT assert anything post-redirect —
 * every page that mounts this login form shows something different once
 * signed in (the reply composer vs. the /edit document list), so callers
 * assert that part themselves.
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
