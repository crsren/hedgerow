// Reader OAuth login + reply-from-the-browser E2E, entirely against the local
// atproto network booted by ./serve.mjs — no Docker, no live network, no real
// accounts. See docs/local-testing.md's "OAuth locally" section for how this
// was originally verified to work at all (a real @atproto/oauth-provider,
// running inside @atproto/dev-env's TestPds with devMode:true and no
// entryway, serves a genuine /oauth/authorize -> password -> consent ->
// redirect flow over plain http://localhost).
//
// Selectors below were found by actually driving this flow in a real browser
// (see git history for the throwaway exploration script this file replaces)
// rather than guessed from the provider's minified UI bundle — the sign-in
// page has a plain `name="password"` input and a "Sign in" submit button; the
// consent page has an "Authorize" submit button. Both are the REAL
// `@atproto/oauth-provider-ui` frontend, not a stub.
//
// Two real plumbing gaps had to be fixed in @hedgerow/reader to make this
// pass (see packages/reader/src/default-client.ts and reader.ts):
//   1. The library's default loopback client id (`buildLoopbackClientId`)
//      folds the current page's PATHNAME into the client id itself, which
//      the provider rejects for any page that isn't the site root — Hedgerow
//      now builds its own spec-correct loopback client id instead.
//   2. The library's default loopback client id also omits `scope`, which
//      defaults to `atproto` only — too narrow for createReply()'s writes.
//      Every authorize call now explicitly requests
//      `atproto transition:generic`.
// A third finding was environmental rather than a bug: this local network has
// no AppView, so `app.bsky.actor.getProfile` 502s right after login —
// restore() no longer lets that failed profile fetch erase a genuinely valid
// session; it falls back to showing the reader's DID until a profile fetch
// eventually succeeds. That's why the assertions below match on "Replying
// as" rather than the literal handle: on a real deployment (a real PDS with
// a real AppView) the fallback never triggers and the handle shows correctly
// — see the reader.ts test suite for that behavior in isolation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { logInWithBluesky } from "./helpers";

interface LocalNet {
  seeded: { slug: string; title: string; anchor: { uri: string; cid: string } } | null;
  reader: { handle: string; password: string; did: string } | null;
}

const localNet: LocalNet = JSON.parse(
  readFileSync(fileURLToPath(new URL("./.local-net.json", import.meta.url)), "utf8"),
);

/**
 * Drive the full reader login (see ./helpers.ts's logInWithBluesky for the
 * shared handle/password/consent steps) and land back on the post page.
 * Asserts the signed-in state is visible before returning.
 */
async function logIn(page: Page, handle: string, password: string): Promise<void> {
  await logInWithBluesky(page, handle, password);

  // Back on the post page, now with the fragment-carried OAuth callback
  // (#state=...&iss=...&code=...) for reader.restore()'s client.init() to
  // complete client-side.
  await page.waitForURL(new RegExp(localNet.seeded!.slug), { timeout: 15_000 });
  await expect(page.getByText(/^Replying as/)).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(() => {
  test.skip(!localNet.seeded, "dev-net seeded no document to test against");
  test.skip(!localNet.reader, "dev-net created no reader account");
});

test("reader can log in with their local atproto account via OAuth", async ({ page }) => {
  test.setTimeout(45_000);
  const { slug } = localNet.seeded!;
  const { handle, password } = localNet.reader!;

  await page.goto(`/${slug}`);
  await page.locator("section.hedgerow").scrollIntoViewIfNeeded();
  await page.waitForSelector(".hedgerow-reply-box");

  await logIn(page, handle, password);

  // Signed in: the login form is gone, the composer (and Sign out) are there.
  await expect(page.getByPlaceholder("your-handle.bsky.social")).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByPlaceholder("Write a reply…")).toBeVisible();
});

test("logged-in reader can post a reply that appears in the thread", async ({ page }) => {
  test.setTimeout(60_000);
  const { slug } = localNet.seeded!;
  const { handle, password } = localNet.reader!;

  await page.goto(`/${slug}`);
  await page.locator("section.hedgerow").scrollIntoViewIfNeeded();
  await page.waitForSelector(".hedgerow-reply-box");
  await logIn(page, handle, password);

  const replyText = `E2E reply from ${handle} — ${Date.now()}`;
  await page.getByPlaceholder("Write a reply…").fill(replyText);
  await page
    .locator(".hedgerow-reply-box")
    .getByRole("button", { name: /^reply$/i })
    .click();

  // The write is real (com.atproto.repo.createRecord on carol's own repo);
  // the UI's indexing-lag retry (up to 3 refetches, 2s apart) is what makes
  // this converge without a hard page reload — see CommentThread.tsx.
  await expect(page.getByText(replyText)).toBeVisible({ timeout: 20_000 });
  // The field clears and the "on its way" fallback note never had to show —
  // proof this was the fast path, not the give-up path.
  await expect(page.getByPlaceholder("Write a reply…")).toHaveValue("");
  await expect(page.locator(".hedgerow-reply-delayed")).toHaveCount(0);
});
