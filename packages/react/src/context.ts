// Context plumbing. Four contexts, each with a strict accessor hook that names
// the part it must live under — so a misplaced `<Comments.Author>` fails loud
// with a useful message instead of a cryptic null read.
import { createContext, useContext, type ReactNode } from "react";
import type { CommentNode } from "@hedgerow/comments";
import type { UseCommentsReturn } from "./useComments";
import type { UseLikesReturn } from "./useLikes";
import type { Like } from "@hedgerow/comments";

// ── Comments ─────────────────────────────────────────────────────────────────

export const CommentsRootContext = createContext<UseCommentsReturn | null>(null);

export function useCommentsContext(): UseCommentsReturn {
  const ctx = useContext(CommentsRootContext);
  if (!ctx) throw new Error("This part must be rendered inside <Comments.Root>.");
  return ctx;
}

/** Per-node state shared down a single comment row (and its recursion). */
export interface CommentItemContextValue {
  node: CommentNode;
  /** 0 for top-level comments, +1 per nesting level. */
  depth: number;
  /** Position among its siblings. */
  index: number;
  /**
   * The `<Comments.Item>` subtree, captured so `<Comments.Replies>` can render
   * the very same template recursively for nested replies.
   */
  template: ReactNode;
}

export const CommentItemContext = createContext<CommentItemContextValue | null>(null);

export function useCommentItemContext(): CommentItemContextValue {
  const ctx = useContext(CommentItemContext);
  if (!ctx) throw new Error("This part must be rendered inside <Comments.Item>.");
  return ctx;
}

/** Non-throwing accessor — for parts (e.g. ReplyLink) usable in or out of an item. */
export function useOptionalCommentItem(): CommentItemContextValue | null {
  return useContext(CommentItemContext);
}

// ── Likes ────────────────────────────────────────────────────────────────────

export const LikesRootContext = createContext<UseLikesReturn | null>(null);

export function useLikesContext(): UseLikesReturn {
  const ctx = useContext(LikesRootContext);
  if (!ctx) throw new Error("This part must be rendered inside <Likes.Root>.");
  return ctx;
}

export const LikeItemContext = createContext<Like | null>(null);

export function useLikeItemContext(): Like {
  const ctx = useContext(LikeItemContext);
  if (!ctx) throw new Error("This part must be rendered inside <Likes.Avatars>.");
  return ctx;
}
