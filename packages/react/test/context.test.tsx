// The context accessors are the "fail loud" guardrails: a part used outside its
// provider must throw a message that names the provider it needs, not read null.
// The non-throwing optional accessor returns null instead.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useCommentsContext,
  useCommentItemContext,
  useLikesContext,
  useLikeItemContext,
  useOptionalCommentItem,
} from "../src/index";

/** Render a hook that is expected to throw, muting React's error logging. */
function expectHookToThrow(hook: () => unknown, message: RegExp) {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => renderHook(hook)).toThrow(message);
  } finally {
    spy.mockRestore();
  }
}

describe("strict context accessors throw outside their provider", () => {
  it("useCommentsContext requires <Comments.Root>", () => {
    expectHookToThrow(useCommentsContext, /<Comments\.Root>/);
  });
  it("useCommentItemContext requires <Comments.Item>", () => {
    expectHookToThrow(useCommentItemContext, /<Comments\.Item>/);
  });
  it("useLikesContext requires <Likes.Root>", () => {
    expectHookToThrow(useLikesContext, /<Likes\.Root>/);
  });
  it("useLikeItemContext requires <Likes.Avatars>", () => {
    expectHookToThrow(useLikeItemContext, /<Likes\.Avatars>/);
  });
});

describe("useOptionalCommentItem", () => {
  it("returns null outside an item rather than throwing", () => {
    const { result } = renderHook(() => useOptionalCommentItem());
    expect(result.current).toBeNull();
  });
});
