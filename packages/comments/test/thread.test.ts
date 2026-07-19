import { describe, expect, it } from "vitest";
import { fetchThread } from "../src/thread.js";
import type { Comment, CommentNode } from "../src/types.js";
import type { RawGetPostThreadResponse } from "../src/types.js";
import { loadFixture, jsonResponse, stubFetch } from "./helpers.js";

const ROOT_URI = "at://did:plc:6kos45lixtga3pdwuncvh32x/app.bsky.feed.post/3mqc36slinc2m";

/** Serve a getPostThread fixture; assert the caller passed the expected depth. */
function threadStub(fixture: string, onParams?: (p: URLSearchParams) => void) {
  const body = loadFixture<RawGetPostThreadResponse>(fixture);
  return stubFetch((url) => {
    if (url.pathname.endsWith("app.bsky.feed.getPostThread")) {
      onParams?.(url.searchParams);
      return jsonResponse(body);
    }
    return jsonResponse({ error: "MethodNotImplemented" }, 501);
  });
}

/** Count all comment nodes and the deepest depth reached in a normalized tree. */
function measure(node: CommentNode, depth = 0): { count: number; maxDepth: number } {
  if (node.type !== "comment") return { count: 0, maxDepth: depth - 1 };
  let count = 1;
  let maxDepth = depth;
  for (const r of node.replies) {
    const m = measure(r, depth + 1);
    count += m.count;
    maxDepth = Math.max(maxDepth, m.maxDepth);
  }
  return { count, maxDepth };
}

describe("fetchThread normalization", () => {
  it("normalizes the root post and its stats", async () => {
    const stub = threadStub("getPostThread");
    const res = await fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true });

    expect(res.uri).toBe(ROOT_URI);
    expect(res.postUrl).toBe(
      "https://bsky.app/profile/did:plc:6kos45lixtga3pdwuncvh32x/post/3mqc36slinc2m",
    );
    expect(res.post.type).toBe("comment");

    const root = res.post as Comment;
    expect(root.uri).toBe(ROOT_URI);
    expect(root.author.handle).toBe("paretooptimizer.bsky.social");
    expect(typeof root.text).toBe("string");
    expect(root.text.length).toBeGreaterThan(0);
    // Stats mirror the root view, quoteCount included.
    expect(res.stats.likeCount).toBe(root.likeCount);
    expect(res.stats.likeCount).toBeGreaterThan(0);
    expect(res.stats.quoteCount).toBeGreaterThanOrEqual(0);
  });

  it("shapes replies into a recursive tree with per-node urls", async () => {
    const stub = threadStub("getPostThread");
    const res = await fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true });
    const root = res.post as Comment;

    expect(root.replies.length).toBeGreaterThan(0);
    const first = root.replies[0] as Comment;
    expect(first.type).toBe("comment");
    expect(first.url).toContain("https://bsky.app/profile/");
    expect(first.url).toContain("/post/");
    // The fixture keeps a genuinely nested chain.
    const { maxDepth } = measure(root);
    expect(maxDepth).toBeGreaterThanOrEqual(2);
  });

  it("passes moderation labels through unfiltered", async () => {
    const stub = threadStub("getPostThread");
    const res = await fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true });
    const root = res.post as Comment;
    // labels is always an array (possibly empty), never dropped.
    expect(Array.isArray(root.labels)).toBe(true);
  });

  it("requests the AppView with the depth param it will cap to", async () => {
    let seen: string | null = null;
    const stub = threadStub("getPostThread", (p) => {
      seen = p.get("depth");
    });
    await fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true, maxDepth: 4 });
    expect(seen).toBe("4");
  });

  it("defensively caps depth during normalization", async () => {
    const stub = threadStub("getPostThread");
    const res = await fetchThread(ROOT_URI, {
      fetchImpl: stub.fetch,
      preResolved: true,
      maxDepth: 1,
    });
    const { maxDepth } = measure(res.post);
    // maxDepth 1 → root (0) plus one level of replies (1), no deeper.
    expect(maxDepth).toBeLessThanOrEqual(1);
    const root = res.post as Comment;
    for (const r of root.replies) {
      if (r.type === "comment") expect(r.replies).toHaveLength(0);
    }
  });
});

describe("fetchThread root-level edge cases", () => {
  it("returns a notFound root with all-zero stats when the whole post is gone", async () => {
    const stub = stubFetch((url) => {
      if (url.pathname.endsWith("app.bsky.feed.getPostThread")) {
        return jsonResponse({
          thread: {
            $type: "app.bsky.feed.defs#notFoundPost",
            uri: ROOT_URI,
            notFound: true,
          },
        });
      }
      return jsonResponse({ error: "MethodNotImplemented" }, 501);
    });

    const res = await fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true });

    expect(res.post.type).toBe("notFound");
    // A stub root carries no engagement — statsOf returns zeros, quoteCount included.
    expect(res.stats).toEqual({ likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 });
    expect(res.postUrl).toContain("/post/");
  });

  it("fills defensive defaults for a sparse post view (no text, counts, or replies)", async () => {
    const stub = stubFetch((url) => {
      if (url.pathname.endsWith("app.bsky.feed.getPostThread")) {
        return jsonResponse({
          thread: {
            $type: "app.bsky.feed.defs#threadViewPost",
            post: {
              uri: ROOT_URI,
              cid: "bafymin",
              author: { did: "did:plc:min", handle: "min.bsky.social" },
              record: {}, // no text / createdAt
              // no likeCount / replyCount / repostCount, no replies array
            },
          },
        });
      }
      return jsonResponse({ error: "MethodNotImplemented" }, 501);
    });

    const res = await fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true });
    const root = res.post as Comment;
    expect(root.text).toBe("");
    expect(root.createdAt).toBe("");
    expect(root.likeCount).toBe(0);
    expect(root.replyCount).toBe(0);
    expect(root.repostCount).toBe(0);
    expect(root.replies).toEqual([]);
  });

  it("resolves a handle-based reference before fetching when not pre-resolved", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((url) => {
      if (url.pathname.endsWith("com.atproto.identity.resolveHandle")) {
        return jsonResponse({ did: "did:plc:6kos45lixtga3pdwuncvh32x" });
      }
      if (url.pathname.endsWith("app.bsky.feed.getPostThread")) return jsonResponse(body);
      return jsonResponse({ error: "MethodNotImplemented" }, 501);
    });

    const res = await fetchThread("https://bsky.app/profile/someone.bsky.social/post/3mqc36slinc2m", {
      fetchImpl: stub.fetch,
      cacheTtlMs: 0,
    });

    expect(res.uri).toBe(ROOT_URI);
    expect(res.post.type).toBe("comment");
    expect(stub.calls[0]).toContain("resolveHandle");
    expect(stub.calls[1]).toContain("getPostThread");
  });
});

describe("fetchThread stub handling", () => {
  it("turns notFoundPost / blockedPost into placeholder nodes, never crashes", async () => {
    const stub = threadStub("thread-with-stubs");
    const res = await fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true });
    const root = res.post as Comment;

    const notFound = root.replies.find((n) => n.type === "notFound");
    const blocked = root.replies.find((n) => n.type === "blocked");
    expect(notFound).toBeDefined();
    expect(notFound!.uri).toContain("gonetoplevel1");
    expect(blocked).toBeDefined();
    expect(blocked).toMatchObject({ type: "blocked", authorDid: "did:plc:blockedblockedbloc" });

    // A nested notFound stub is preserved inside a real reply's subtree.
    const realReply = root.replies.find((n) => n.type === "comment") as Comment;
    const nestedReal = realReply.replies[0] as Comment;
    expect(nestedReal.type).toBe("comment");
    expect(nestedReal.replies[0]!.type).toBe("notFound");
  });
});
