import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useComments, useLikes, useCommentNode } from "../src/index";
import type { CommentNode, RawGetPostThreadResponse, Comment } from "@hedgerow/comments";
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
