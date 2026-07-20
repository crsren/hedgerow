// The two flagship journeys of the interaction-first / auth-on-demand
// redesign (see CommentThread.tsx's module doc comment and
// @hedgerow/react's README "Auth on demand" recipe), driven end to end
// against the local atproto network booted by ./serve.mjs — no Docker, no
// live network, no real accounts.
//
// Both prove the SAME underlying mechanism (a sessionStorage-stashed intent,
// keyed by post, written right before reader.signIn()'s real redirect and
// read back once reader.restore() resolves after it) through its two
// different endings:
//   - a "reply" intent is restored but NOT auto-posted — the reader gets
//     their draft + retarget banner back and takes one deliberate click;
//   - a "like" intent auto-applies the moment the reader is back, since
//     liking already fully expresses the intent with nothing left to decide.
//
// See oauth-reply.spec.ts for the underlying OAuth/write/like mechanics in
// isolation (now reached through this same modal for its own tests too).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { logInWithBluesky, scrollToComments } from "./helpers";

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

test("signed out -> compose a targeted reply -> gate -> log in -> draft and reply-target survive the redirect -> one click posts it", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { slug } = localNet.seeded!;
  const { handle, password } = localNet.reader!;

  await page.goto(`/${slug}`);
  await scrollToComments(page);
  await page.waitForSelector(".hedgerow-reply-box");

  // Retarget the composer at a specific comment FIRST — free, no session
  // needed (see handleCommentAction's "reply" branch in CommentThread.tsx) —
  // so the flagship journey proves the reply TARGET survives the redirect,
  // not just the draft text.
  const targetItem = page.locator(".hedgerow-item", {
    hasText: "Nice piece — this is exactly why I moved",
  });
  await targetItem.getByRole("button", { name: /^reply$/i }).first().click();
  await expect(page.locator(".hedgerow-reply-target")).toContainText("bob.test");

  // Compose-first: type a full reply while still signed out.
  const replyText = `Flagship journey reply from ${handle} — ${Date.now()}`;
  const field = page.getByPlaceholder("Write a reply…");
  await field.fill(replyText);

  // Submit gates: opens the modal instead of posting or failing.
  await page
    .locator(".hedgerow-reply-box")
    .getByRole("button", { name: /^reply$/i })
    .click();
  const dialog = page.locator(".hedgerow-auth-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Join the conversation" })).toBeVisible();

  // Underneath the modal, nothing was lost — this dialog didn't clear the
  // composer to open.
  await expect(field).toHaveValue(replyText);
  await expect(page.locator(".hedgerow-reply-target")).toContainText("bob.test");

  // The real OAuth screens: password + consent, served by the local PDS's
  // actual @atproto/oauth-provider (see docs/local-testing.md's "OAuth
  // locally").
  await logInWithBluesky(page, handle, password);

  // Back on the post page, signed in.
  await page.waitForURL(new RegExp(slug), { timeout: 15_000 });
  await expect(page.locator(".hedgerow-auth-dialog")).toHaveCount(0);
  await expect(page.getByText(/^Replying as/)).toBeVisible({ timeout: 10_000 });

  // Rehydrated: the draft and the "Replying to @bob.test" banner both
  // survived the full navigation away and back — restored from the
  // sessionStorage stash (readStashedIntent/CommentThread's rehydration
  // effect), NOT merely because the page never reloaded.
  await expect(field).toHaveValue(replyText);
  await expect(page.locator(".hedgerow-reply-target")).toContainText("bob.test");

  // NOT auto-posted (point 3: a pending "reply" is deliberately held back for
  // one deliberate click) — no matching item exists yet anywhere in the thread.
  await expect(page.locator(".hedgerow-item", { hasText: replyText })).toHaveCount(0);

  // The one deliberate click.
  const replyButton = page.locator(".hedgerow-reply-box").getByRole("button", { name: /^reply$/i });
  await expect(replyButton).toBeEnabled();
  await replyButton.click();

  // Lands nested under the originally-targeted comment, same as an ordinary
  // (never-gated) targeted reply — see oauth-reply.spec.ts's own version of
  // this assertion.
  const nested = targetItem.locator(".hedgerow-replies .hedgerow-item", { hasText: replyText });
  await expect(nested).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".hedgerow-reply-target")).toHaveCount(0);
  await expect(field).toHaveValue("");
});

test("signed out -> like -> gate -> log in -> the like applies automatically on return, no extra click", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const { slug } = localNet.seeded!;
  const { handle, password } = localNet.reader!;

  await page.goto(`/${slug}`);
  await scrollToComments(page);
  await page.waitForSelector(".hedgerow-reply-box");

  const likeButton = page.locator(".hedgerow-like-button");
  await expect(likeButton).toBeEnabled();
  await expect(likeButton).not.toHaveAttribute("data-liked", "");
  const before = await likeCountText(page);

  await likeButton.click();

  // Rejecting is how the like gate rolls the button's own optimistic flip
  // back (see PostLikeButton's onLike in CommentThread.tsx) — so right after
  // the click, the button reads as NOT liked again, with the modal open as
  // the actual feedback.
  const dialog = page.locator(".hedgerow-auth-dialog");
  await expect(dialog).toBeVisible();
  await expect(likeButton).not.toHaveAttribute("data-liked", "");
  await expect.poll(async () => likeCountText(page)).toBe(before);

  await logInWithBluesky(page, handle, password);

  await page.waitForURL(new RegExp(slug), { timeout: 15_000 });
  await expect(page.locator(".hedgerow-auth-dialog")).toHaveCount(0);
  await expect(page.getByText(/^Replying as/)).toBeVisible({ timeout: 10_000 });

  // Applied automatically — no click needed here, unlike the reply journey
  // above. A real app.bsky.feed.like record now exists (reader.like() ran
  // inside PostLikeButton's pending-intent effect), so this also survives a
  // reload, same guarantee oauth-reply.spec.ts's ordinary like test checks.
  await expect(page.locator(".hedgerow-like-button")).toHaveAttribute("data-liked", "", { timeout: 10_000 });
  await expect.poll(async () => likeCountText(page)).toBe(before + 1);

  await page.reload();
  await page.waitForSelector("section.hedgerow");
  await scrollToComments(page);
  await expect(page.locator(".hedgerow-like-button")).toHaveAttribute("data-liked", "", { timeout: 10_000 });
  await expect.poll(async () => likeCountText(page)).toBe(before + 1);

  // Restore the baseline like state — this suite's specs share one dev-net
  // (and one reader account, carol.test) across the whole run, same as
  // oauth-reply.spec.ts's own like test; leaving the post liked here would
  // desync every later spec's "before" count (read-path.spec.ts asserts an
  // exact "1 like", for instance).
  await page.locator(".hedgerow-like-button").click();
  await expect(page.locator(".hedgerow-like-button")).not.toHaveAttribute("data-liked", "");
  await expect.poll(async () => likeCountText(page)).toBe(before);
});

async function likeCountText(page: import("@playwright/test").Page): Promise<number> {
  const text = await page.locator(".hedgerow-likecount").textContent();
  return Number((text ?? "").match(/\d+/)?.[0] ?? NaN);
}
