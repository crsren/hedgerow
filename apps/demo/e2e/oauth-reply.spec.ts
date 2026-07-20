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
import { expect, test } from "@playwright/test";
import { logIn } from "./helpers";

interface LocalNet {
  seeded: { slug: string; title: string; anchor: { uri: string; cid: string } } | null;
  reader: { handle: string; password: string; did: string } | null;
}

const localNet: LocalNet = JSON.parse(
  readFileSync(fileURLToPath(new URL("./.local-net.json", import.meta.url)), "utf8"),
);

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

  await logIn(page, handle, password, slug);

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
  await logIn(page, handle, password, slug);

  const replyText = `E2E reply from ${handle} — ${Date.now()}`;
  await page.getByPlaceholder("Write a reply…").fill(replyText);
  await page
    .locator(".hedgerow-reply-box")
    .getByRole("button", { name: /^reply$/i })
    .click();

  // SLIMS-69: the reply is now optimistically inserted the instant
  // createReply() resolves (see useComments' addOptimisticReply /
  // CommentThread.tsx's ReplyBox) — no need to wait out the AppView's
  // indexing lag to see it show up at all.
  const item = page.locator(".hedgerow-item", { hasText: replyText });
  await expect(item).toBeVisible({ timeout: 5_000 });
  await expect(item).toHaveAttribute("data-state", "pending");
  await expect(page.getByPlaceholder("Write a reply…")).toHaveValue("");

  // The write is real (com.atproto.repo.createRecord on carol's own repo) —
  // once the shim's own getPostThread has indexed it (the UI's own
  // confirm-sweep retry loop, up to 3 refetches a few seconds apart), the
  // pending marker clears and it's an ordinary comment.
  await expect(item).not.toHaveAttribute("data-state", "pending", { timeout: 20_000 });
  await expect(item).not.toHaveAttribute("data-state", "unconfirmed");
});

test("reader can like the post: count increments, survives reload, unlike decrements", async ({ page }) => {
  test.setTimeout(45_000);
  const { slug } = localNet.seeded!;
  const { handle, password } = localNet.reader!;

  await page.goto(`/${slug}`);
  await page.locator("section.hedgerow").scrollIntoViewIfNeeded();
  await page.waitForSelector(".hedgerow-reply-box");
  await logIn(page, handle, password, slug);

  const likeButton = page.locator(".hedgerow-like-button");
  await expect(likeButton).toBeEnabled();
  const before = await likeCountText(page);

  await likeButton.click();
  await expect(likeButton).toHaveAttribute("data-liked", "");
  await expect
    .poll(async () => likeCountText(page))
    .toBe(before + 1);

  // Survives reload: this is a real app.bsky.feed.like record, not just
  // client-side optimistic state — reader.findLike() re-derives "liked" from
  // the reader's own repo on the fresh page load.
  await page.reload();
  await page.waitForSelector("section.hedgerow");
  await page.locator("section.hedgerow").scrollIntoViewIfNeeded();
  await expect(page.locator(".hedgerow-like-button")).toHaveAttribute("data-liked", "", { timeout: 10_000 });
  await expect.poll(async () => likeCountText(page)).toBe(before + 1);

  await page.locator(".hedgerow-like-button").click();
  await expect(page.locator(".hedgerow-like-button")).not.toHaveAttribute("data-liked", "");
  await expect.poll(async () => likeCountText(page)).toBe(before);
});

async function likeCountText(page: import("@playwright/test").Page): Promise<number> {
  const text = await page.locator(".hedgerow-likecount").textContent();
  return Number((text ?? "").match(/\d+/)?.[0] ?? NaN);
}

test("reader can reply to a specific comment, and it nests under it", async ({ page }) => {
  test.setTimeout(60_000);
  const { slug } = localNet.seeded!;
  const { handle, password } = localNet.reader!;

  await page.goto(`/${slug}`);
  await page.locator("section.hedgerow").scrollIntoViewIfNeeded();
  await page.waitForSelector(".hedgerow-reply-box");
  await logIn(page, handle, password, slug);

  // Target bob's first seeded reply specifically (dev-net.mjs seeds two, this
  // is the top-level one) — not the root post.
  const targetItem = page.locator(".hedgerow-item", {
    hasText: "Nice piece — this is exactly why I moved",
  });
  await targetItem.getByRole("button", { name: /^reply$/i }).first().click();

  // Composer retargeted: "Replying to @bob.test" banner, cancel affordance.
  await expect(page.locator(".hedgerow-reply-target")).toContainText("bob.test");

  const replyText = `Nested E2E reply from ${handle} — ${Date.now()}`;
  await page.getByPlaceholder("Write a reply…").fill(replyText);
  await page
    .locator(".hedgerow-reply-box")
    .getByRole("button", { name: /^reply$/i })
    .click();

  // Nested UNDER the targeted comment, not appended at the top level.
  const nested = targetItem.locator(".hedgerow-replies .hedgerow-item", { hasText: replyText });
  await expect(nested).toBeVisible({ timeout: 5_000 });

  // Retargeting reset back to the root post after a successful send.
  await expect(page.locator(".hedgerow-reply-target")).toHaveCount(0);
});
