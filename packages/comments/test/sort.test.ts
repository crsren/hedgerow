import { describe, expect, it } from "vitest";
import { sortReplies } from "../src/sort.js";
import type { Comment, CommentNode } from "../src/types.js";

function comment(overrides: Partial<Comment> & Pick<Comment, "uri">): Comment {
  return {
    type: "comment",
    cid: "cid",
    author: { did: "did:plc:x", handle: "a.bsky.social" },
    text: "t",
    createdAt: "2020-01-01T00:00:00Z",
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    labels: [],
    replies: [],
    url: "https://bsky.app/",
    ...overrides,
  };
}

const a = comment({ uri: "a", createdAt: "2021-01-01T00:00:00Z", likeCount: 5 });
const b = comment({ uri: "b", createdAt: "2023-01-01T00:00:00Z", likeCount: 1 });
const c = comment({ uri: "c", createdAt: "2022-01-01T00:00:00Z", likeCount: 9 });
const stub: CommentNode = { type: "notFound", uri: "gone" };

describe("sortReplies", () => {
  it("orders newest first", () => {
    const out = sortReplies([a, b, c], "newest").map((n) => n.uri);
    expect(out).toEqual(["b", "c", "a"]);
  });

  it("orders oldest first", () => {
    const out = sortReplies([a, b, c], "oldest").map((n) => n.uri);
    expect(out).toEqual(["a", "c", "b"]);
  });

  it("orders most-liked first", () => {
    const out = sortReplies([a, b, c], "most-liked").map((n) => n.uri);
    expect(out).toEqual(["c", "a", "b"]);
  });

  it("sorts nested replies recursively", () => {
    const parent = comment({ uri: "p", replies: [a, b, c] });
    const [sorted] = sortReplies([parent], "newest") as [Comment];
    expect(sorted.replies.map((n) => n.uri)).toEqual(["b", "c", "a"]);
  });

  it("pushes notFound/blocked stubs to the end", () => {
    const out = sortReplies([stub, a, b], "newest").map((n) => n.uri);
    expect(out[out.length - 1]).toBe("gone");
  });

  it("does not mutate the input array or nodes", () => {
    const input = [a, b, c];
    const snapshot = input.map((n) => n.uri);
    sortReplies(input, "most-liked");
    expect(input.map((n) => n.uri)).toEqual(snapshot);
  });
});
