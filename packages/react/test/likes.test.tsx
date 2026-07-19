import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Likes } from "../src/index";
import { loadFixture, jsonResponse, stubFetch, ROOT_URI } from "./helpers";

function likesStub() {
  const body = loadFixture("getLikes");
  return stubFetch((method) =>
    method === "app.bsky.feed.getLikes" ? jsonResponse(body) : jsonResponse({}, 501),
  );
}

describe("Likes components", () => {
  it("renders the count and a capped avatar stack", async () => {
    const stub = likesStub();
    const { container, findByText } = render(
      <Likes.Root post={ROOT_URI} maxPages={1} fetchImpl={stub.fetch}>
        <Likes.Loading>Loading…</Likes.Loading>
        <Likes.Empty>No likes yet</Likes.Empty>
        <Likes.Count />
        <Likes.Avatars max={3} data-testid="stack" />
      </Likes.Root>,
    );

    await findByText("5");
    const imgs = container.querySelectorAll('[data-testid="stack"] img');
    expect(imgs.length).toBe(3);
    // First liker's handle is reflected on its avatar.
    expect(imgs[0]?.getAttribute("data-handle")).toBe("dah1234.bsky.social");
  });

  it("reflects status as data-attributes on Root", async () => {
    const stub = likesStub();
    const { container } = render(
      <Likes.Root post={ROOT_URI} maxPages={1} fetchImpl={stub.fetch} data-testid="likes">
        <Likes.Count />
      </Likes.Root>,
    );
    const root = container.querySelector('[data-testid="likes"]')!;
    await waitFor(() => expect(root.getAttribute("data-status")).toBe("success"));
    expect(root.getAttribute("data-total")).toBe("5");
    expect(root.hasAttribute("data-loading")).toBe(false);
  });

  it("lazy-loads liker avatars", async () => {
    const stub = likesStub();
    const { container } = render(
      <Likes.Root post={ROOT_URI} maxPages={1} fetchImpl={stub.fetch}>
        <Likes.Avatars max={2} data-testid="stack" />
      </Likes.Root>,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="stack"] img')).not.toBeNull(),
    );
    for (const img of container.querySelectorAll('[data-testid="stack"] img')) {
      expect(img.getAttribute("loading")).toBe("lazy");
    }
  });

  it("renders a custom avatar template per liker", async () => {
    const stub = likesStub();
    const { container, findByText } = render(
      <Likes.Root post={ROOT_URI} maxPages={1} fetchImpl={stub.fetch}>
        <Likes.Avatars max={2}>
          <Likes.Avatar render={(props, state) => <span {...props}>{state.actor.handle}</span>} />
        </Likes.Avatars>
      </Likes.Root>,
    );
    await findByText("dah1234.bsky.social");
    expect(container.querySelectorAll("span").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the Empty part when the post has no likes", async () => {
    const stub = stubFetch((method) =>
      method === "app.bsky.feed.getLikes"
        ? jsonResponse({ uri: ROOT_URI, likes: [] })
        : jsonResponse({}, 501),
    );
    const { findByText, container } = render(
      <Likes.Root post={ROOT_URI} maxPages={1} fetchImpl={stub.fetch}>
        <Likes.Empty>No likes yet</Likes.Empty>
        <Likes.Count />
      </Likes.Root>,
    );
    const empty = await findByText("No likes yet");
    expect(empty.hasAttribute("data-empty")).toBe(true);
  });

  it("renders the Error part (role=alert) when the likes fetch fails", async () => {
    const stub = stubFetch(() => jsonResponse({ error: "NotFound", message: "gone" }, 404));
    const { findByText } = render(
      <Likes.Root post={ROOT_URI} fetchImpl={stub.fetch}>
        <Likes.Loading>Loading…</Likes.Loading>
        <Likes.Error>Could not load likes</Likes.Error>
      </Likes.Root>,
    );
    const alert = await findByText("Could not load likes");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.hasAttribute("data-error")).toBe(true);
  });
});
