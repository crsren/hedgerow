import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useComments, useLikes } from "../src/index";
import type { RawGetPostThreadResponse, Comment } from "@hedgerow/comments";
import { loadFixture, jsonResponse, stubFetch, ROOT_URI } from "./helpers";

function threadFetch() {
  const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
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
});
