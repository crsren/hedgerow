import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useComments, useLikes, useCommentNode } from "../src/index";
import type {
  CommentNode,
  RawGetPostThreadResponse,
  Comment,
  ThreadResult,
  LikesResult,
} from "@hedgerow/comments";
import { CommentItemContext } from "../src/context";
import { loadFixture, jsonResponse, stubFetch, ROOT_URI } from "./helpers";

function threadFetch(fixture = "getPostThread") {
  const body = loadFixture<RawGetPostThreadResponse>(fixture);
  return stubFetch((method) =>
    method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
  ).fetch;
}

describe("useComments (hooks-only)", () => {
  it("drives idle → loading → success and derives the comment tree", async () => {
    const { result } = renderHook(() => useComments({ post: ROOT_URI, fetchImpl: threadFetch() }));

    // Effect has already advanced past idle by first commit.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.comments).toHaveLength(6);
    expect(result.current.stats?.likeCount).toBe(6496);
    expect(result.current.root?.type).toBe("comment");
    expect(result.current.isEmpty).toBe(false);
  });

  it("re-sorts client-side via setSort without refetching", async () => {
    const fetchImpl = threadFetch();
    const { result } = renderHook(() => useComments({ post: ROOT_URI, sort: "newest", fetchImpl }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const times = () => result.current.comments.map((c) => (c as Comment).createdAt);
    const newest = times();
    expect(newest).toEqual([...newest].sort((a, b) => Date.parse(b) - Date.parse(a)));

    act(() => result.current.setSort("oldest"));
    expect(result.current.comments.map((c) => (c as Comment).createdAt)).toEqual(
      [...newest].reverse(),
    );

    act(() => result.current.setSort("most-liked"));
    const liked = result.current.comments.map((c) => (c as Comment).likeCount);
    expect(liked).toEqual([...liked].sort((a, b) => b - a));
  });

  it("starts in success when seeded with initialData and skips the mount fetch", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    // Build a ThreadResult by loading once through the core-shaped fixture path.
    const seed = await import("@hedgerow/comments").then((m) =>
      m.fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true }),
    );
    const callsBefore = stub.calls.length;

    const { result } = renderHook(() =>
      useComments({ post: ROOT_URI, initialData: seed, fetchImpl: stub.fetch }),
    );
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.comments).toHaveLength(6);
    // No additional fetch fired on mount.
    await waitFor(() => expect(stub.calls.length).toBe(callsBefore));
  });

  it("captures the error on failure", async () => {
    const stub = stubFetch(() => jsonResponse({ error: "NotFound" }, 404));
    const { result } = renderHook(() => useComments({ post: ROOT_URI, fetchImpl: stub.fetch }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("applies a filter recursively — stubs kept, matching comments kept", async () => {
    const { result } = renderHook(() =>
      useComments({
        post: ROOT_URI,
        fetchImpl: threadFetch("thread-with-stubs"),
        // Keep every non-comment stub, and comments that have text.
        filter: (n) => n.type !== "comment" || n.text.length > 0,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const kinds = result.current.comments.map((c) => c.type);
    expect(kinds).toContain("notFound"); // stub branch of filterTree
    expect(kinds).toContain("comment"); // comment branch + recursion
  });

  it("yields an empty, isEmpty result when the filter rejects everything", async () => {
    const { result } = renderHook(() =>
      useComments({ post: ROOT_URI, fetchImpl: threadFetch(), filter: () => false }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.comments).toEqual([]);
    expect(result.current.isEmpty).toBe(true);
  });

  it("forwards maxDepth and appView through to the fetch", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const { result } = renderHook(() =>
      useComments({
        post: ROOT_URI,
        maxDepth: 3,
        appView: "https://appview.test",
        cacheTtlMs: 0,
        fetchImpl: stub.fetch,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(stub.calls[0]!);
    expect(url.origin).toBe("https://appview.test");
    expect(url.searchParams.get("depth")).toBe("3");
  });
});

describe("useCommentNode", () => {
  it("returns the node from the surrounding item context", () => {
    const node: CommentNode = { type: "notFound", uri: "at://gone" };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CommentItemContext.Provider value={{ node, depth: 0, index: 0, template: null }}>
        {children}
      </CommentItemContext.Provider>
    );
    const { result } = renderHook(() => useCommentNode(), { wrapper });
    expect(result.current).toBe(node);
  });
});

describe("useLikes (hooks-only)", () => {
  it("collects likes and reports the total", async () => {
    const body = loadFixture("getLikes");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getLikes" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const { result } = renderHook(() =>
      useLikes({ post: ROOT_URI, maxPages: 1, fetchImpl: stub.fetch }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.total).toBe(5);
    expect(result.current.likes[0]?.actor.handle).toBe("dah1234.bsky.social");
  });

  it("seeds from initialData and skips the mount fetch", async () => {
    const seed = {
      uri: ROOT_URI,
      likes: [{ actor: { did: "did:plc:a", handle: "a.bsky.social" } }],
      total: 1,
      cursor: undefined,
    };
    const stub = stubFetch(() => jsonResponse({}, 501));
    const { result } = renderHook(() =>
      useLikes({ post: ROOT_URI, initialData: seed, fetchImpl: stub.fetch }),
    );
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.total).toBe(1);
    expect(result.current.likes).toHaveLength(1);
    await waitFor(() => expect(stub.calls.length).toBe(0));
  });

  it("captures the error when the likes fetch fails", async () => {
    const stub = stubFetch(() => jsonResponse({ error: "NotFound" }, 404));
    const { result } = renderHook(() => useLikes({ post: ROOT_URI, fetchImpl: stub.fetch }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.likes).toEqual([]);
  });

  it("forwards pageSize, maxPages, and appView through to the fetch", async () => {
    const body = loadFixture("getLikes");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getLikes"
        ? jsonResponse({ ...(body as object), cursor: undefined })
        : jsonResponse({}, 501),
    );
    const { result } = renderHook(() =>
      useLikes({
        post: ROOT_URI,
        pageSize: 10,
        maxPages: 1,
        appView: "https://appview.test",
        cacheTtlMs: 0,
        fetchImpl: stub.fetch,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(stub.calls[0]!);
    expect(url.origin).toBe("https://appview.test");
    expect(url.searchParams.get("limit")).toBe("10");
  });
});

// ── SLIMS-70: correctness bugs ──────────────────────────────────────────────

describe("useComments stale-while-error", () => {
  it("keeps the previous data (and derived comments) showing when a REFETCH fails — isError and stale data coexist", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    let calls = 0;
    const stub = stubFetch((method) => {
      if (method !== "app.bsky.feed.getPostThread") return jsonResponse({}, 501);
      calls += 1;
      return calls === 1 ? jsonResponse(body) : jsonResponse({ error: "InternalServerError" }, 500);
    });
    const { result } = renderHook(() => useComments({ post: ROOT_URI, fetchImpl: stub.fetch }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const firstData = result.current.data;
    expect(result.current.comments).toHaveLength(6);

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBe(firstData); // not nulled out
    expect(result.current.comments).toHaveLength(6); // thread keeps rendering
    expect(result.current.isSuccess).toBe(false);
  });

  it("a fetch that never had prior data still ends up with data: undefined on failure (ordinary case, unaffected)", async () => {
    const stub = stubFetch(() => jsonResponse({ error: "NotFound" }, 404));
    const { result } = renderHook(() => useComments({ post: ROOT_URI, fetchImpl: stub.fetch }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useComments initialData under React Strict Mode (idempotent mount-fetch guard)", () => {
  const StrictWrapper = ({ children }: { children: React.ReactNode }) => (
    <React.StrictMode>{children}</React.StrictMode>
  );

  it("does not fire a mount fetch when seeded, even with the effect double-invoked", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const seed = await import("@hedgerow/comments").then((m) =>
      m.fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true }),
    );
    const callsAfterSeed = stub.calls.length;

    const { result } = renderHook(
      () => useComments({ post: ROOT_URI, initialData: seed, fetchImpl: stub.fetch }),
      { wrapper: StrictWrapper },
    );
    expect(result.current.isSuccess).toBe(true);
    // Give a wrongly-firing effect a tick to show up.
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.calls.length).toBe(callsAfterSeed);
  });

  it("still refetches when `post` changes, even after being seeded (post-prop change is never suppressed)", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const seed = await import("@hedgerow/comments").then((m) =>
      m.fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true }),
    );
    const callsAfterSeed = stub.calls.length;
    const OTHER_URI = "at://did:plc:6kos45lixtga3pdwuncvh32x/app.bsky.feed.post/other";

    const { rerender } = renderHook(
      ({ post }: { post: string }) => useComments({ post, initialData: seed, fetchImpl: stub.fetch }),
      { initialProps: { post: ROOT_URI }, wrapper: StrictWrapper },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.calls.length).toBe(callsAfterSeed); // still seeded, no fetch yet

    rerender({ post: OTHER_URI });
    await waitFor(() => expect(stub.calls.length).toBeGreaterThan(callsAfterSeed));
  });
});

describe("useComments controlled data mode", () => {
  it("never fetches on its own; status/comments derive from the `data` prop as it changes", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const seeder = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const fetched = await import("@hedgerow/comments").then((m) =>
      m.fetchThread(ROOT_URI, { fetchImpl: seeder.fetch, preResolved: true }),
    );
    const neverCalled = stubFetch(() => {
      throw new Error("must never fetch in controlled mode");
    });

    const { result, rerender } = renderHook(
      ({ data }: { data: ThreadResult | undefined }) =>
        useComments({ post: ROOT_URI, data, fetchImpl: neverCalled.fetch }),
      { initialProps: { data: undefined as ThreadResult | undefined } },
    );
    // `data` key present but undefined — TSQ-style "still pending" — reads idle, not loading.
    expect(result.current.status).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRevalidating).toBe(false);
    expect(result.current.comments).toEqual([]);

    rerender({ data: fetched });
    expect(result.current.status).toBe("success");
    expect(result.current.comments).toHaveLength(6);
    expect(neverCalled.calls).toHaveLength(0);
  });

  it("refetch() calls onRefetch instead of fetching", () => {
    const onRefetch = vi.fn();
    const neverCalled = stubFetch(() => {
      throw new Error("must never fetch");
    });
    const { result } = renderHook(() =>
      useComments({ post: ROOT_URI, data: undefined, onRefetch, fetchImpl: neverCalled.fetch }),
    );
    act(() => result.current.refetch());
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(neverCalled.calls).toHaveLength(0);
  });

  it("runs the optimistic confirm sweep on each new `data` reference (TSQ-style confirm)", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const seeder = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const initial = await import("@hedgerow/comments").then((m) =>
      m.fetchThread(ROOT_URI, { fetchImpl: seeder.fetch, preResolved: true }),
    );
    const neverCalled = stubFetch(() => {
      throw new Error("must never fetch in controlled mode");
    });

    const { result, rerender } = renderHook(
      ({ data }: { data: ThreadResult }) => useComments({ post: ROOT_URI, data, fetchImpl: neverCalled.fetch }),
      { initialProps: { data: initial } },
    );

    const newUri = "at://did:plc:me/app.bsky.feed.post/controlled-opt";
    act(() => {
      result.current.addOptimisticReply({
        ref: { uri: newUri, cid: "bafycontrolledopt" },
        parentUri: ROOT_URI,
        text: "controlled optimistic reply",
        author: { did: "did:plc:me", handle: "me.bsky.social" },
      });
    });
    expect(result.current.deliveryStateOf(newUri)).toBe("pending");

    // A brand-new `data` reference — as if the consumer's own query refetched
    // — that now contains the reply.
    const root = initial.post;
    const confirmed: ThreadResult = {
      ...initial,
      post:
        root.type === "comment"
          ? {
              ...root,
              replies: [
                ...root.replies,
                {
                  type: "comment",
                  uri: newUri,
                  cid: "bafycontrolledopt",
                  author: { did: "did:plc:me", handle: "me.bsky.social" },
                  text: "controlled optimistic reply",
                  createdAt: new Date().toISOString(),
                  likeCount: 0,
                  replyCount: 0,
                  repostCount: 0,
                  labels: [],
                  replies: [],
                  url: "https://bsky.app/profile/did:plc:me/post/controlled-opt",
                },
              ],
            }
          : root,
    };
    rerender({ data: confirmed });

    await waitFor(() => expect(result.current.deliveryStateOf(newUri)).toBe("confirmed"));
    expect(neverCalled.calls).toHaveLength(0);
  });
});

describe("useComments revalidateOnMount", () => {
  it("fires exactly one extra refetch right after mount when seeded, then settles", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const seed = await import("@hedgerow/comments").then((m) =>
      m.fetchThread(ROOT_URI, { fetchImpl: stub.fetch, preResolved: true }),
    );
    const callsAfterSeed = stub.calls.length;

    const { result } = renderHook(() =>
      useComments({ post: ROOT_URI, initialData: seed, fetchImpl: stub.fetch, revalidateOnMount: true }),
    );
    // Seeded data is showing immediately (never `isLoading` — no flash) even
    // though, by the time `renderHook` returns (RTL's `act()` has already
    // flushed the mount effects, including the revalidate fetch's own
    // synchronous "start loading" state update), the extra refetch may
    // already be in flight as a background `isRevalidating`.
    expect(result.current.data).toBe(seed);
    expect(result.current.isLoading).toBe(false);
    await waitFor(() => expect(stub.calls.length).toBe(callsAfterSeed + 1));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.calls.length).toBe(callsAfterSeed + 1); // not re-fired again
  });

  it("is a no-op without initialData — the ordinary single mount fetch still happens, nothing extra", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const { result } = renderHook(() =>
      useComments({ post: ROOT_URI, fetchImpl: stub.fetch, revalidateOnMount: true }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.calls).toHaveLength(1);
  });
});

describe("useComments confirmRetryDelays", () => {
  it("refetches at each scheduled delay while the reply is still pending", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(body) : jsonResponse({}, 501),
    );
    const { result } = renderHook(() =>
      useComments({ post: ROOT_URI, fetchImpl: stub.fetch, confirmRetryDelays: [30, 60] }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const callsAfterMount = stub.calls.length;

    act(() => {
      result.current.addOptimisticReply({
        ref: { uri: "at://did:plc:me/app.bsky.feed.post/retry1", cid: "bafyretry1" },
        parentUri: ROOT_URI,
        text: "still pending (fixture never contains this uri)",
        author: { did: "did:plc:me", handle: "me.bsky.social" },
      });
    });

    await waitFor(() => expect(stub.calls.length).toBe(callsAfterMount + 1), { timeout: 2000 });
    await waitFor(() => expect(stub.calls.length).toBe(callsAfterMount + 2), { timeout: 2000 });
  });

  it("does not fire a scheduled retry once the reply has already been confirmed by an earlier refetch", async () => {
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread") as RawGetPostThreadResponse & {
      thread: { replies: unknown[] };
    };
    const newUri = "at://did:plc:me/app.bsky.feed.post/confirmed-early";
    let confirmed = false;
    const stub = stubFetch((method) => {
      if (method !== "app.bsky.feed.getPostThread") return jsonResponse({}, 501);
      if (!confirmed) return jsonResponse(body);
      return jsonResponse({
        ...body,
        thread: {
          ...body.thread,
          replies: [
            ...body.thread.replies,
            {
              $type: "app.bsky.feed.defs#threadViewPost",
              post: {
                uri: newUri,
                cid: "bafyconfirmedearly",
                author: { did: "did:plc:me", handle: "me.bsky.social" },
                record: {
                  $type: "app.bsky.feed.post",
                  text: "confirmed on the very next fetch",
                  createdAt: new Date().toISOString(),
                },
                likeCount: 0,
                replyCount: 0,
                repostCount: 0,
                indexedAt: new Date().toISOString(),
              },
              replies: [],
            },
          ],
        },
      });
    });
    const { result } = renderHook(() =>
      // Second delay (5s) is far past this test's patience — it must simply
      // never fire an extra fetch once the first (30ms) delay has confirmed.
      useComments({ post: ROOT_URI, fetchImpl: stub.fetch, confirmRetryDelays: [30, 5000] }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => {
      result.current.addOptimisticReply({
        ref: { uri: newUri, cid: "bafyconfirmedearly" },
        parentUri: ROOT_URI,
        text: "confirmed on the very next fetch",
        author: { did: "did:plc:me", handle: "me.bsky.social" },
      });
    });
    expect(result.current.deliveryStateOf(newUri)).toBe("pending");

    confirmed = true; // the "server" now has it indexed before the schedule even needs it
    await waitFor(() => expect(result.current.deliveryStateOf(newUri)).toBeUndefined(), { timeout: 2000 });

    const callsAfterConfirm = stub.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(stub.calls.length).toBe(callsAfterConfirm); // no extra refetch since confirming
  });
});

describe("useLikes stale-while-error", () => {
  it("keeps previous likes showing when a REFETCH fails", async () => {
    const body = loadFixture("getLikes");
    let calls = 0;
    const stub = stubFetch((method) => {
      if (method !== "app.bsky.feed.getLikes") return jsonResponse({}, 501);
      calls += 1;
      return calls === 1 ? jsonResponse(body) : jsonResponse({ error: "InternalServerError" }, 500);
    });
    const { result } = renderHook(() => useLikes({ post: ROOT_URI, maxPages: 1, fetchImpl: stub.fetch }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const firstData = result.current.data;
    expect(result.current.likes.length).toBeGreaterThan(0);

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBe(firstData);
    expect(result.current.likes.length).toBeGreaterThan(0);
  });
});

describe("useLikes initialData under React Strict Mode", () => {
  it("does not fire a mount fetch when seeded, even with the effect double-invoked", async () => {
    const seed = { uri: ROOT_URI, likes: [{ actor: { did: "did:plc:a", handle: "a.bsky.social" } }], total: 1, cursor: undefined };
    const stub = stubFetch(() => jsonResponse({}, 501));
    const { result } = renderHook(() => useLikes({ post: ROOT_URI, initialData: seed, fetchImpl: stub.fetch }), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    expect(result.current.isSuccess).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.calls).toHaveLength(0);
  });
});

describe("useLikes controlled data mode", () => {
  it("never fetches on its own; total/likes derive from the `data` prop as it changes", async () => {
    const neverCalled = stubFetch(() => {
      throw new Error("must never fetch in controlled mode");
    });
    const seed: LikesResult = {
      uri: ROOT_URI,
      likes: [{ actor: { did: "did:plc:a", handle: "a.bsky.social" } }],
      total: 1,
      cursor: undefined,
    };

    const { result, rerender } = renderHook(
      ({ data }: { data: LikesResult | undefined }) => useLikes({ post: ROOT_URI, data, fetchImpl: neverCalled.fetch }),
      { initialProps: { data: undefined as LikesResult | undefined } },
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.total).toBe(0);

    rerender({ data: seed });
    expect(result.current.status).toBe("success");
    expect(result.current.total).toBe(1);
    expect(neverCalled.calls).toHaveLength(0);
  });

  it("refetch() calls onRefetch instead of fetching", () => {
    const onRefetch = vi.fn();
    const neverCalled = stubFetch(() => {
      throw new Error("must never fetch");
    });
    const { result } = renderHook(() =>
      useLikes({ post: ROOT_URI, data: undefined, onRefetch, fetchImpl: neverCalled.fetch }),
    );
    act(() => result.current.refetch());
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(neverCalled.calls).toHaveLength(0);
  });
});

describe("useLikes revalidateOnMount", () => {
  it("fires exactly one extra refetch right after mount when seeded", async () => {
    const body = loadFixture("getLikes");
    const stub = stubFetch((method) => (method === "app.bsky.feed.getLikes" ? jsonResponse(body) : jsonResponse({}, 501)));
    const seed = { uri: ROOT_URI, likes: [{ actor: { did: "did:plc:a", handle: "a.bsky.social" } }], total: 1, cursor: undefined };

    const { result } = renderHook(() =>
      useLikes({
        post: ROOT_URI,
        maxPages: 1,
        initialData: seed,
        fetchImpl: stub.fetch,
        revalidateOnMount: true,
      }),
    );
    // See the identical useComments test above for why this isn't asserted
    // synchronously as `isSuccess` — the revalidate fetch may already be
    // mid-flight (isRevalidating) by the time `renderHook` returns.
    expect(result.current.data).toBe(seed);
    expect(result.current.isLoading).toBe(false);
    await waitFor(() => expect(stub.calls.length).toBe(1));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.calls).toHaveLength(1);
  });
});
