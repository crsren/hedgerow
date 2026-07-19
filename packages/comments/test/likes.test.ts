import { describe, expect, it } from "vitest";
import { fetchLikes } from "../src/likes.js";
import type { RawGetLikesResponse } from "../src/types.js";
import { loadFixture, jsonResponse, stubFetch } from "./helpers.js";

const POST_URI = "at://did:plc:6kos45lixtga3pdwuncvh32x/app.bsky.feed.post/3mqc36slinc2m";

/**
 * Serve the three getLikes fixtures as a real cursor chain: page1 (no cursor
 * param) → page2 → page3 (terminal, no further cursor).
 */
function likesStub() {
  const p1 = loadFixture<RawGetLikesResponse>("getLikes");
  const p2 = loadFixture<RawGetLikesResponse>("getLikes-page2");
  const p3 = loadFixture<RawGetLikesResponse>("getLikes-page3");
  return stubFetch((url) => {
    if (!url.pathname.endsWith("app.bsky.feed.getLikes")) {
      return jsonResponse({ error: "MethodNotImplemented" }, 501);
    }
    const cursor = url.searchParams.get("cursor");
    if (cursor === null) return jsonResponse(p1);
    if (cursor === p1.cursor) return jsonResponse(p2);
    if (cursor === p2.cursor) return jsonResponse(p3);
    return jsonResponse({ uri: POST_URI, likes: [] });
  });
}

describe("fetchLikes pagination", () => {
  it("pages the cursor to the natural end and flattens actors", async () => {
    const stub = likesStub();
    const p1 = loadFixture<RawGetLikesResponse>("getLikes");
    const p2 = loadFixture<RawGetLikesResponse>("getLikes-page2");
    const p3 = loadFixture<RawGetLikesResponse>("getLikes-page3");
    const expectedTotal = p1.likes.length + p2.likes.length + p3.likes.length;

    const res = await fetchLikes(POST_URI, { fetchImpl: stub.fetch, preResolved: true });

    expect(res.uri).toBe(POST_URI);
    expect(res.total).toBe(expectedTotal);
    expect(res.likes).toHaveLength(expectedTotal);
    expect(res.cursor).toBeUndefined(); // fully paged
    expect(stub.calls).toHaveLength(3);

    const first = res.likes[0]!;
    expect(first.actor.did).toBe(p1.likes[0]!.actor.did);
    expect(first.actor.handle).toBe(p1.likes[0]!.actor.handle);
    expect(first.createdAt).toBe(p1.likes[0]!.createdAt);
  });

  it("stops at maxPages and returns the cursor for the remainder", async () => {
    const stub = likesStub();
    const p1 = loadFixture<RawGetLikesResponse>("getLikes");
    const p2 = loadFixture<RawGetLikesResponse>("getLikes-page2");

    const res = await fetchLikes(POST_URI, {
      fetchImpl: stub.fetch,
      preResolved: true,
      maxPages: 2,
    });

    expect(stub.calls).toHaveLength(2);
    expect(res.total).toBe(p1.likes.length + p2.likes.length);
    // Two pages fetched, both carried a cursor → there's more to fetch.
    expect(res.cursor).toBe(p2.cursor);
  });

  it("honors the page size in the request", async () => {
    const stub = likesStub();
    await fetchLikes(POST_URI, {
      fetchImpl: stub.fetch,
      preResolved: true,
      pageSize: 25,
      maxPages: 1,
    });
    expect(new URL(stub.calls[0]!).searchParams.get("limit")).toBe("25");
  });
});
