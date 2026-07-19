// Regression: likes arriving between page fetches can shift the cursor window
// so the same actor appears on two pages — fetchLikes must dedup by DID or
// `total` overcounts and DID-keyed renderers get duplicate React keys.
import { describe, expect, it } from "vitest";
import { fetchLikes } from "../src/likes.js";

const actor = (n: number) => ({
  did: `did:plc:actor${n}`,
  handle: `actor${n}.test`,
  displayName: `Actor ${n}`,
});

describe("fetchLikes cross-page dedup", () => {
  it("drops an actor repeated across pages and does not overcount total", async () => {
    const pages = [
      { likes: [1, 2, 3].map((n) => ({ actor: actor(n), createdAt: "2026-01-01T00:00:00Z", indexedAt: "2026-01-01T00:00:00Z" })), cursor: "p2" },
      // actor 3 repeats on page 2 (cursor window shifted underneath us)
      { likes: [3, 4].map((n) => ({ actor: actor(n), createdAt: "2026-01-01T00:00:00Z", indexedAt: "2026-01-01T00:00:00Z" })) },
    ];
    let call = 0;
    const fetchImpl = (async () =>
      new Response(JSON.stringify(pages[call++]))) as unknown as typeof fetch;

    const result = await fetchLikes("at://did:plc:x/app.bsky.feed.post/3abc", {
      preResolved: true,
      fetchImpl,
    });

    const dids = result.likes.map((l) => l.actor.did);
    expect(dids).toEqual(["did:plc:actor1", "did:plc:actor2", "did:plc:actor3", "did:plc:actor4"]);
    expect(new Set(dids).size).toBe(dids.length);
    expect(result.total).toBe(4);
  });
});
