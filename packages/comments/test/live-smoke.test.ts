// Live drift check against the REAL public AppView. Skipped unless LIVE_SMOKE
// is set, so CI stays fixtures-only and offline. Run manually when you suspect
// upstream lexicon drift:  LIVE_SMOKE=1 pnpm --filter @hedgerow/comments test
import { describe, expect, it } from "vitest";
import { fetchThread } from "../src/thread.js";
import { fetchLikes } from "../src/likes.js";
import { resolvePostUri } from "../src/resolve.js";

// The post the checked-in fixtures were captured from.
const FIXTURE_POST =
  "at://did:plc:6kos45lixtga3pdwuncvh32x/app.bsky.feed.post/3mqc36slinc2m";

describe.skipIf(!process.env.LIVE_SMOKE)("live smoke (real AppView)", () => {
  it("resolves a handle-based reference to a DID at:// URI", async () => {
    const uri = await resolvePostUri("https://bsky.app/profile/bsky.app/post/x");
    expect(uri).toMatch(/^at:\/\/did:plc:[a-z0-9]+\/app\.bsky\.feed\.post\/x$/);
  });

  it("fetches and normalizes a real thread", async () => {
    const res = await fetchThread(FIXTURE_POST, { preResolved: true });
    expect(res.post.type).toBe("comment");
    if (res.post.type === "comment") {
      expect(res.post.replies.length).toBeGreaterThan(0);
    }
    expect(res.stats.likeCount).toBeGreaterThan(0);
  });

  it("fetches real likes", async () => {
    const res = await fetchLikes(FIXTURE_POST, { preResolved: true, maxPages: 1 });
    expect(res.likes.length).toBeGreaterThan(0);
    expect(res.likes[0]!.actor.handle).toBeTruthy();
  });
});
