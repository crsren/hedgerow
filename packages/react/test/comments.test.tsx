import { describe, it, expect } from "vitest";
import { render, act, waitFor, within } from "@testing-library/react";
import { Comments } from "../src/index";
import type { RawGetPostThreadResponse } from "@hedgerow/comments";
import { loadFixture, jsonResponse, stubFetch, deferred, ROOT_URI } from "./helpers";

/** The canonical item template, exercised by most tests. */
function Thread(props: React.ComponentProps<typeof Comments.Root>) {
  return (
    <Comments.Root {...props}>
      <Comments.Loading>Loading…</Comments.Loading>
      <Comments.Error>Something went wrong</Comments.Error>
      <Comments.Empty>Be the first to reply on Bluesky</Comments.Empty>
      <Comments.List data-testid="list">
        <Comments.Item>
          <Comments.Fallback />
          <Comments.Author />
          <Comments.Content />
          <Comments.Timestamp />
          <Comments.Likes />
          <Comments.Labels />
          <Comments.Replies />
        </Comments.Item>
      </Comments.List>
    </Comments.Root>
  );
}

/** getPostThread served from a fixture. */
function threadStub(fixture: string) {
  const body = loadFixture<RawGetPostThreadResponse>(fixture);
  return stubFetch((method) =>
    method === "app.bsky.feed.getPostThread"
      ? jsonResponse(body)
      : jsonResponse({ error: "MethodNotImplemented" }, 501),
  );
}

/** A minimal live thread with no replies. */
const EMPTY_THREAD: RawGetPostThreadResponse = {
  thread: {
    $type: "app.bsky.feed.defs#threadViewPost",
    post: {
      uri: ROOT_URI,
      cid: "bafyempty",
      author: { did: "did:plc:6kos45lixtga3pdwuncvh32x", handle: "author.bsky.social" },
      record: { $type: "app.bsky.feed.post", text: "root", createdAt: "2026-01-01T00:00:00.000Z" },
      likeCount: 3,
      replyCount: 0,
      repostCount: 0,
      quoteCount: 1,
      indexedAt: "2026-01-01T00:00:00.000Z",
    },
    replies: [],
  },
};

describe("Comments happy path", () => {
  it("renders the full thread once loaded", async () => {
    const stub = threadStub("getPostThread");
    const { container } = render(<Thread post={ROOT_URI} fetchImpl={stub.fetch} />);

    // A real reply author from the fixture appears (displayName is the default text).
    await waitFor(() =>
      expect(container.querySelector('[data-handle="fredrikb.bsky.social"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-handle="fredrikb.bsky.social"]')!.textContent).toBe(
      "Fredrik Boström",
    );

    // 6 top-level comments, each an Item at depth 0.
    const topLevel = container.querySelectorAll('[data-comment][data-depth="0"]');
    expect(topLevel.length).toBe(6);

    // Nested replies rendered too (fixture has depth ≥ 2).
    expect(container.querySelector('[data-comment][data-depth="2"]')).not.toBeNull();

    // Every comment carries a machine-readable timestamp.
    expect(container.querySelector("time[datetime]")).not.toBeNull();
  });

  it("exposes root stats through Comments.Stats render prop", async () => {
    const stub = threadStub("getPostThread");
    const { findByTestId } = render(
      <Comments.Root post={ROOT_URI} fetchImpl={stub.fetch}>
        <Comments.Stats data-testid="stats">
          {null}
        </Comments.Stats>
        <Comments.Stats
          data-testid="stats-rendered"
          render={(props, state) => <div {...props}>{state.likeCount} likes</div>}
        />
      </Comments.Root>,
    );
    const stats = await findByTestId("stats");
    await waitFor(() => expect(stats.getAttribute("data-like-count")).toBe("6496"));
    expect(stats.getAttribute("data-reply-count")).toBe("149");
    expect((await findByTestId("stats-rendered")).textContent).toBe("6496 likes");
  });
});

describe("Comments state machine", () => {
  it("shows Loading while pending, then the thread", async () => {
    const gate = deferred<Response>();
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? gate.promise : jsonResponse({}, 501),
    );

    const { queryByText, container } = render(<Thread post={ROOT_URI} fetchImpl={stub.fetch} />);

    // The effect has moved us into `loading` synchronously.
    expect(queryByText("Loading…")).not.toBeNull();

    await act(async () => {
      gate.resolve(jsonResponse(body));
    });

    await waitFor(() => expect(container.querySelector("[data-comment]")).not.toBeNull());
    expect(queryByText("Loading…")).toBeNull();
  });

  it("renders the Error part when the fetch fails", async () => {
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread"
        ? jsonResponse({ error: "NotFound", message: "gone" }, 404)
        : jsonResponse({}, 501),
    );
    const { findByText, queryByText } = render(<Thread post={ROOT_URI} fetchImpl={stub.fetch} />);

    await findByText("Something went wrong");
    expect(queryByText("Loading…")).toBeNull();
  });

  it("renders the Empty part when there are no comments", async () => {
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? jsonResponse(EMPTY_THREAD) : jsonResponse({}, 501),
    );
    const { findByText, container } = render(<Thread post={ROOT_URI} fetchImpl={stub.fetch} />);

    await findByText("Be the first to reply on Bluesky");
    expect(container.querySelectorAll('[data-comment]').length).toBe(0);
  });
});

describe("Comments stubs, labels, sort", () => {
  it("renders blocked and notFound replies through Comments.Fallback", async () => {
    const stub = threadStub("thread-with-stubs");
    const { container } = render(<Thread post={ROOT_URI} fetchImpl={stub.fetch} />);

    await waitFor(() => expect(container.querySelector("[data-not-found]")).not.toBeNull());
    expect(container.querySelector("[data-not-found]")!.textContent).toContain(
      "This reply was deleted",
    );
    expect(container.querySelector("[data-blocked]")!.textContent).toContain("Blocked reply");
    // Stubs never render Author/Content — only the fallback.
    const notFound = container.querySelector("[data-not-found]")!;
    expect(within(notFound as HTMLElement).queryByText(/\.bsky\.social/)).toBeNull();
  });

  it("surfaces moderation labels as data-attributes and text", async () => {
    const stub = threadStub("getPostThread");
    const { container } = render(<Thread post={ROOT_URI} fetchImpl={stub.fetch} />);

    await waitFor(() => expect(container.querySelector("[data-labeled]")).not.toBeNull());
    const labeled = container.querySelector("[data-labeled]")!;
    // The Labels span reflects the value both as text and data-values.
    expect(labeled.textContent).toContain("!no-unauthenticated");
  });

  it("orders top-level comments by the sort prop", async () => {
    const readTimestamps = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('[data-comment][data-depth="0"]')).map(
        (item) => item.querySelector("time")!.getAttribute("datetime")!,
      );

    const newest = render(<Thread post={ROOT_URI} sort="newest" fetchImpl={threadStub("getPostThread").fetch} />);
    await waitFor(() => expect(newest.container.querySelector("[data-comment]")).not.toBeNull());
    const newestTimes = readTimestamps(newest.container);

    const oldest = render(<Thread post={ROOT_URI} sort="oldest" fetchImpl={threadStub("getPostThread").fetch} />);
    await waitFor(() => expect(oldest.container.querySelector("[data-comment]")).not.toBeNull());
    const oldestTimes = readTimestamps(oldest.container);

    // Newest-first is strictly descending; oldest-first is its exact reverse.
    const descending = [...newestTimes].sort((a, b) => Date.parse(b) - Date.parse(a));
    expect(newestTimes).toEqual(descending);
    expect(oldestTimes).toEqual([...newestTimes].reverse());
  });
});

describe("Comments.ReplyLink", () => {
  it("links to the root post outside an item and to the comment inside one", async () => {
    const stub = threadStub("getPostThread");
    const { container, findByTestId } = render(
      <Comments.Root post={ROOT_URI} fetchImpl={stub.fetch}>
        <Comments.ReplyLink data-testid="root-reply" />
        <Comments.List>
          <Comments.Item>
            <Comments.ReplyLink data-testid="item-reply" />
          </Comments.Item>
        </Comments.List>
      </Comments.Root>,
    );

    // Outside any item → targets the root post, flagged data-root, opens a new tab.
    const rootLink = await findByTestId("root-reply");
    expect(rootLink.getAttribute("href")).toContain(
      "/profile/did:plc:6kos45lixtga3pdwuncvh32x/post/",
    );
    expect(rootLink.hasAttribute("data-root")).toBe(true);
    expect(rootLink.getAttribute("target")).toBe("_blank");
    expect(rootLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(rootLink.textContent).toBe("Reply on Bluesky");

    // Inside an item → targets that comment, and is NOT flagged data-root.
    const itemLinks = container.querySelectorAll('[data-testid="item-reply"]');
    expect(itemLinks.length).toBeGreaterThan(0);
    const first = itemLinks[0] as HTMLAnchorElement;
    expect(first.getAttribute("href")).toContain("/post/");
    expect(first.hasAttribute("data-root")).toBe(false);
  });

  it("renders custom link text via children", async () => {
    const stub = threadStub("getPostThread");
    const { findByText } = render(
      <Comments.Root post={ROOT_URI} fetchImpl={stub.fetch}>
        <Comments.ReplyLink>Join the conversation</Comments.ReplyLink>
      </Comments.Root>,
    );
    const link = await findByText("Join the conversation");
    expect(link.tagName).toBe("A");
  });
});

describe("Comments accessibility", () => {
  it("marks Root aria-busy while loading and clears it once loaded", async () => {
    const gate = deferred<Response>();
    const body = loadFixture<RawGetPostThreadResponse>("getPostThread");
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getPostThread" ? gate.promise : jsonResponse({}, 501),
    );
    const { container } = render(
      <Comments.Root post={ROOT_URI} fetchImpl={stub.fetch} data-testid="root">
        <Comments.List>
          <Comments.Item>
            <Comments.Author />
            <Comments.Replies />
          </Comments.Item>
        </Comments.List>
      </Comments.Root>,
    );
    const root = container.querySelector('[data-testid="root"]')!;
    expect(root.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      gate.resolve(jsonResponse(body));
    });
    await waitFor(() => expect(root.hasAttribute("aria-busy")).toBe(false));
  });

  it("gives List/Replies list semantics and each Item a listitem role", async () => {
    const stub = threadStub("getPostThread");
    const { getByTestId, container } = render(<Thread post={ROOT_URI} fetchImpl={stub.fetch} />);

    await waitFor(() => expect(container.querySelector('[role="listitem"]')).not.toBeNull());
    // The List is a list, and its direct children are listitems.
    const list = getByTestId("list");
    expect(list.getAttribute("role")).toBe("list");
    // Nested replies carry their own list role (fixture nests ≥ 2 deep).
    expect(container.querySelectorAll('[role="list"]').length).toBeGreaterThan(1);
    // Every top-level comment is a listitem.
    for (const item of container.querySelectorAll('[data-comment][data-depth="0"]')) {
      expect(item.getAttribute("role")).toBe("listitem");
    }
  });

  it("lazy-loads comment avatars", async () => {
    const stub = threadStub("getPostThread");
    const { container } = render(
      <Comments.Root post={ROOT_URI} fetchImpl={stub.fetch}>
        <Comments.List>
          <Comments.Item>
            <Comments.Avatar />
            <Comments.Replies />
          </Comments.Item>
        </Comments.List>
      </Comments.Root>,
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")!.getAttribute("loading")).toBe("lazy");
  });

  it("lets a consumer override the default role via props", async () => {
    const stub = threadStub("getPostThread");
    const { getByTestId } = render(
      <Comments.Root post={ROOT_URI} fetchImpl={stub.fetch}>
        <Comments.List data-testid="list" role="presentation">
          <Comments.Item>
            <Comments.Author />
            <Comments.Replies />
          </Comments.Item>
        </Comments.List>
      </Comments.Root>,
    );
    await waitFor(() => expect(getByTestId("list").getAttribute("role")).toBe("presentation"));
  });
});

describe("Comments render-prop and data-attributes", () => {
  it("swaps the element via render and merges className", async () => {
    const stub = threadStub("getPostThread");
    const { container } = render(
      <Comments.Root post={ROOT_URI} fetchImpl={stub.fetch}>
        <Comments.List>
          <Comments.Item>
            <Comments.Author
              className="author"
              render={(props) => <a href="#" {...props} />}
            />
            <Comments.Replies />
          </Comments.Item>
        </Comments.List>
      </Comments.Root>,
    );
    await waitFor(() => expect(container.querySelector("a.author")).not.toBeNull());
    const anchor = container.querySelector("a.author")!;
    // Our className merged with the render element's, and data-* came through.
    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("data-handle")).toBeTruthy();
  });
});
