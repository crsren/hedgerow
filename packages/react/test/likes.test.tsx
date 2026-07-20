import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
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

describe("Likes.Button", () => {
  it("renders unliked, toggles to liked on click, and optimistically bumps the count", async () => {
    const onLike = vi.fn(async () => {});
    const onUnlike = vi.fn(async () => {});
    const { getByRole } = render(
      <Likes.Button liked={false} count={4} onLike={onLike} onUnlike={onUnlike} />,
    );
    const button = getByRole("button") as HTMLButtonElement;
    expect(button.textContent).toBe("♡ 4");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.hasAttribute("data-liked")).toBe(false);

    fireEvent.click(button);
    // Optimistic: flips immediately, before onLike resolves.
    expect(button.textContent).toBe("♥ 5");
    expect(button.hasAttribute("data-liked")).toBe(true);
    expect(button.hasAttribute("data-busy")).toBe(true);

    await waitFor(() => expect(onLike).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button.hasAttribute("data-busy")).toBe(false));
    expect(onUnlike).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic count when onLike rejects", async () => {
    const onLike = vi.fn(async () => {
      throw new Error("write failed");
    });
    const { getByRole } = render(<Likes.Button liked={false} count={4} onLike={onLike} onUnlike={vi.fn()} />);
    const button = getByRole("button") as HTMLButtonElement;

    fireEvent.click(button);
    expect(button.textContent).toBe("♥ 5");
    await waitFor(() => expect(button.textContent).toBe("♡ 4")); // rolled back
    expect(button.hasAttribute("data-liked")).toBe(false);
  });

  it("is disabled when the liked state is unknown or disabled is set", () => {
    const { getByRole, rerender } = render(
      <Likes.Button liked={undefined} count={0} onLike={vi.fn()} onUnlike={vi.fn()} />,
    );
    expect((getByRole("button") as HTMLButtonElement).disabled).toBe(true);

    rerender(<Likes.Button liked={false} count={0} onLike={vi.fn()} onUnlike={vi.fn()} disabled />);
    expect((getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(getByRole("button").getAttribute("data-disabled")).toBe("");
  });

  it("toggles unliked when already liked", async () => {
    const onUnlike = vi.fn(async () => {});
    const { getByRole } = render(<Likes.Button liked={true} count={5} onLike={vi.fn()} onUnlike={onUnlike} />);
    const button = getByRole("button");
    fireEvent.click(button);
    expect(button.textContent).toBe("♡ 4");
    await waitFor(() => expect(onUnlike).toHaveBeenCalledTimes(1));
  });
});
