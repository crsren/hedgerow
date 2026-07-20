// The /edit author flow, end to end (SLIMS-64), against the local atproto
// network booted by ./serve.mjs — no Docker, no live network, no real
// accounts. See docs/local-testing.md.
//
// Proves: alice.test (the site owner, HEDGEROW_HANDLE — see dev-net.mjs) can
// sign in on /edit with the SAME "Log in with Bluesky" UI the reply box uses
// (./helpers.ts's logInWithBluesky), see her published posts, edit a
// document's title + body through @hedgerow/react's Editor.* parts (Tiptap
// mounted into Editor.Body), save it (reader.asPublisher().putRecord — a
// real com.atproto.repo.putRecord on her own repo), and that BOTH the public
// post page (server reads live from the PDS) and the record's textContent
// mirror reflect the change afterwards.
//
// Deliberately edits a DIFFERENT document than `localNet.seeded` — that one
// carries the comment thread read-path.spec.ts and oauth-reply.spec.ts
// assert against (all three specs share the SAME dev-net for the whole test
// run), so renaming it here would poison those. dev-net.mjs publishes two
// demo posts; this picks whichever one ISN'T the seeded post.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { AtpAgent } from "@atproto/api";
import { logInWithBluesky } from "./helpers";

interface LocalNet {
  HEDGEROW_PDS_URL?: string;
  seeded: { slug: string; title: string; anchor: { uri: string; cid: string } } | null;
  author: { handle: string; password: string; did: string } | null;
}

const localNet: LocalNet = JSON.parse(
  readFileSync(fileURLToPath(new URL("./.local-net.json", import.meta.url)), "utf8"),
);

/** Drive the /edit sign-in (shared login UI) and wait for the signed-in author view. */
async function logInToEdit(page: Page, handle: string, password: string): Promise<void> {
  await logInWithBluesky(page, handle, password);
  await page.waitForURL(/\/edit/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(() => {
  test.skip(!localNet.seeded, "dev-net seeded no document to test against");
  test.skip(!localNet.author, "dev-net created no author account");
});

test("author can sign in on /edit, edit a post, and save it", async ({ page }) => {
  test.setTimeout(60_000);
  const { title: seededTitle } = localNet.seeded!;
  const { handle, password, did } = localNet.author!;

  await page.goto("/edit");
  await page.waitForSelector('input[placeholder="your-handle.bsky.social"]');
  await logInToEdit(page, handle, password);

  // Pick whichever listed post is NOT the seeded one (see the file comment).
  await page.waitForSelector(".hedgerow-edit-list-item");
  const otherPost = page.locator(".hedgerow-edit-list-item").filter({ hasNotText: seededTitle }).first();
  await expect(otherPost).toBeVisible();
  await otherPost.click();

  // The "View live post" link's href gives us the slug (derived from the
  // record's own `path`) without hard-coding which demo post this is.
  const viewLink = page.locator(".hedgerow-edit-view-link");
  await expect(viewLink).toBeVisible();
  const href = await viewLink.getAttribute("href");
  const slug = href?.replace(/^\/+/, "");
  expect(slug).toBeTruthy();

  const newTitle = `Edited via /edit — ${Date.now()}`;
  const newBodyLine = `This paragraph was rewritten through the Tiptap editor at ${Date.now()}.`;

  const titleInput = page.locator(".hedgerow-edit-title");
  await titleInput.fill(newTitle);

  // The body is Tiptap (a contenteditable ProseMirror doc, not a <textarea>) —
  // select all and retype, same as a real author rewriting a paragraph.
  const body = page.locator(".hedgerow-edit-tiptap .ProseMirror");
  await body.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(newBodyLine);

  const saveButton = page.locator(".hedgerow-edit-save");
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect(page.locator(".hedgerow-edit-status-part")).toHaveText("Saved", { timeout: 15_000 });

  // The public post page (server-rendered, reading live from the PDS — see
  // apps/demo/src/lib/site.ts's loadSite()) shows the new content on reload.
  await page.goto(`/${slug}`);
  await expect(page.getByRole("heading", { name: newTitle, level: 1 })).toBeVisible();
  await expect(page.getByText(newBodyLine)).toBeVisible();

  // The record's textContent mirror (the plaintext fallback every
  // standard.site reader can trust — see docs/architecture.md) was updated
  // too, fetched directly via com.atproto.repo.getRecord rather than through
  // the demo's own render path, so this is an independent check.
  const pdsUrl = localNet.HEDGEROW_PDS_URL;
  expect(pdsUrl).toBeTruthy();
  const agent = new AtpAgent({ service: pdsUrl! });

  // Find the document the same way EditorIsland does: list the repo's
  // site.standard.document records and match by path.
  const listed = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: "site.standard.document",
  });
  const record = listed.data.records.find((r) => (r.value as { path?: string }).path === `/${slug}`);
  expect(record).toBeDefined();
  const value = record!.value as { title: string; textContent?: string; content?: { markdown?: string } };
  expect(value.title).toBe(newTitle);
  expect(value.textContent).toContain(newBodyLine);
  expect(value.content?.markdown).toContain(newBodyLine);
});
