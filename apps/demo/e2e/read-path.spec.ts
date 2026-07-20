// Proves the READ path end-to-end in a real browser, entirely against the
// local atproto network booted by ./serve.mjs (see ../playwright.config.ts):
//
//   publish (dev-net.mjs, via @hedgerow/publish) -> site render (astro,
//   HEDGEROW_HANDLE live mode reading the local PDS) -> comments island
//   (client-hydrated, reading the local AppView shim) -> a real seeded reply
//   + like from a second local account.
//
// No Docker, no live network, no real accounts — see docs/local-testing.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

interface LocalNet {
  HEDGEROW_APPVIEW_URL: string;
  seeded: { slug: string; title: string; anchor: { uri: string; cid: string } } | null;
}

const localNet: LocalNet = JSON.parse(
  readFileSync(fileURLToPath(new URL("./.local-net.json", import.meta.url)), "utf8"),
);

test.beforeEach(async ({ page }) => {
  // The comments island (apps/demo/src/components/CommentThread.tsx, owned by
  // a colleague's branch) is hardcoded to fetch the public Bluesky AppView —
  // see DEFAULT_APPVIEW in packages/comments/src/xrpc.ts. Rather than touch
  // that component to make the AppView configurable, redirect its requests at
  // the network level to our local shim, which serves the same XRPC methods
  // computed off records that actually live on the local PDS. The island's
  // code — and the @hedgerow/react parts it's built from — never knows the
  // difference.
  await page.route("https://public.api.bsky.app/xrpc/**", async (route) => {
    const reqUrl = new URL(route.request().url());
    const target = new URL(localNet.HEDGEROW_APPVIEW_URL);
    target.pathname = reqUrl.pathname;
    target.search = reqUrl.search;
    const res = await page.request.fetch(target.toString(), { method: route.request().method() });
    await route.fulfill({ response: res });
  });
});

test("home page renders the publication and documents from the local PDS", async ({ page }) => {
  await page.goto("/");

  // The <link rel="site.standard.publication"> only appears in live mode
  // (HEDGEROW_HANDLE) and its href is the record's real at:// URI — proof
  // this page came from PDS records, not from local markdown.
  const pubLink = page.locator('link[rel="site.standard.publication"]');
  await expect(pubLink).toHaveAttribute("href", /^at:\/\/did:plc:/);

  expect(localNet.seeded).not.toBeNull();
  await expect(page.getByRole("link", { name: localNet.seeded!.title })).toBeVisible();
});

test("post page renders from a PDS document record and the comment thread loads the seeded reply + like", async ({
  page,
}) => {
  test.skip(!localNet.seeded, "dev-net seeded no document to test against");
  const { slug, title } = localNet.seeded!;

  await page.goto(`/${slug}`);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();

  // Proves this page, too, is rendered from a real document record.
  await expect(page.locator('link[rel="site.standard.document"]')).toHaveAttribute(
    "href",
    /^at:\/\/did:plc:/,
  );

  // The comments island hydrates on scroll-into-view (client:visible).
  const comments = page.locator("section.hedgerow");
  await comments.scrollIntoViewIfNeeded();

  await expect(page.locator(".hedgerow-item").first()).toBeVisible();
  await expect(page.getByText("Nice piece — this is exactly why I moved")).toBeVisible();
  await expect(page.getByText("The record-vs-page framing finally clicked")).toBeVisible();

  // The like count is the root post's true likeCount (not a page-capped
  // getLikes count) — see LikeCount in CommentThread.tsx.
  await expect(page.locator(".hedgerow-likecount")).toHaveText("1 like");
});
