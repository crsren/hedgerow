// Proves the exact bug the AppView shim's listRepos-based account discovery
// fixes (apps/demo/scripts/appview-shim.mjs, SLIMS-69): an account created
// AFTER the local network booted — not one of dev-net.mjs's seeded
// alice/bob/carol — must still show up when it replies. Before that fix, the
// shim only ever walked `accounts.keys()` (a static Map populated at boot),
// so a late-created repo's posts were invisible to getPostThread no matter
// how it replied: the write succeeded, the UI's own retry loop kept
// refetching, and the reply just never appeared — a real bug the project
// owner hit live via the actual "Sign up with Bluesky" flow.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AtpAgent } from "@atproto/api";
import { expect, test } from "@playwright/test";
import { scrollToComments, signInViaAuthGate } from "./helpers";

interface LocalNet {
  seeded: { slug: string; title: string; anchor: { uri: string; cid: string } } | null;
  HEDGEROW_PDS_URL?: string;
}

const localNet: LocalNet = JSON.parse(
  readFileSync(fileURLToPath(new URL("./.local-net.json", import.meta.url)), "utf8"),
);

test.beforeEach(() => {
  test.skip(!localNet.seeded, "dev-net seeded no document to test against");
  test.skip(!localNet.HEDGEROW_PDS_URL, "dev-net wrote no PDS url");
});

test("a reader who signs up AFTER the network booted still shows up when they reply", async ({ page }) => {
  test.setTimeout(60_000);
  const { slug } = localNet.seeded!;

  // Deliberately NOT part of dev-net.mjs's seeded accounts map (alice/bob/
  // carol) — created here, well after startDevNet() returned, exactly like a
  // reader hitting "Sign up with Bluesky" mid-session would be.
  const handle = `dave-${Date.now()}.test`;
  const password = "hunter2hunter2"; // local-only dev-net account, never a real credential
  const dave = new AtpAgent({ service: localNet.HEDGEROW_PDS_URL! });
  await dave.createAccount({ handle, email: `${handle}@dev-net.local`, password });

  await page.goto(`/${slug}`);
  await scrollToComments(page);
  await page.waitForSelector(".hedgerow-reply-box");
  await signInViaAuthGate(page, handle, password, slug);

  const replyText = `Late-signup reply from ${handle} — ${Date.now()}`;
  await page.getByPlaceholder("Write a reply…").fill(replyText);
  await page
    .locator(".hedgerow-reply-box")
    .getByRole("button", { name: /^reply$/i })
    .click();

  // Optimistic insert shows this immediately regardless of the shim — that's
  // not what's under test here. The real proof is that it SURVIVES a reload,
  // once the shim's own getPostThread (walking com.atproto.sync.listRepos,
  // not a boot-time seed Map) has actually indexed dave's repo.
  await expect(page.locator("section.hedgerow").getByText(replyText)).toBeVisible({ timeout: 5_000 });
  await page.reload();
  await page.waitForSelector("section.hedgerow");
  await scrollToComments(page);
  await expect(page.locator("section.hedgerow").getByText(replyText)).toBeVisible({ timeout: 20_000 });
});
