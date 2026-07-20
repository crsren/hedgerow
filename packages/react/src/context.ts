// Context plumbing. Five contexts, each with a strict accessor hook that names
// the part it must live under — so a misplaced `<Comments.Author>` fails loud
// with a useful message instead of a cryptic null read.
import { createContext, useContext, type ReactNode } from "react";
import type { Comment, CommentNode } from "@hedgerow/comments";
import type { UseCommentsReturn } from "./useComments";
import type { UseLikesReturn } from "./useLikes";
import type { Like } from "@hedgerow/comments";
import type { UseReplyReturn } from "./useReply";
import type { UseEditorReturn } from "./useEditor";

// ── Comments ─────────────────────────────────────────────────────────────────

/** Discriminant for `Comments.Root`'s `onCommentAction` — see comments.tsx's `LikeButton`/`ReplyButton`. */
export type CommentAction = "like" | "unlike" | "reply";

/**
 * `useComments`'s return, plus the two purely-UI callback props `Comments.Root`
 * takes to wire per-comment like/reply triggers — kept OUT of `useComments`
 * itself (which stays a pure fetch/sort/optimistic-merge engine) since these
 * are just passed straight through from props to context for
 * `Comments.LikeButton`/`Comments.ReplyButton` to read. Both are optional and
 * `undefined` disables the parts that need them — same "injected, not
 * imported" contract `Reply.Root`'s `session`/`onSubmit` use, so `@hedgerow/react`
 * still never imports `@hedgerow/reader` or any other auth library.
 */
export interface CommentsContextValue extends UseCommentsReturn {
  /** Handle a like/unlike/reply trigger from `Comments.LikeButton`/`Comments.ReplyButton`. */
  onCommentAction?: (action: CommentAction, node: Comment) => void | Promise<void>;
  /** Whether the reader has already liked `node`. `undefined` = unknown (e.g. a findLike lookup still resolving). */
  isCommentLiked?: (node: Comment) => boolean | undefined;
}

export const CommentsRootContext = createContext<CommentsContextValue | null>(null);

export function useCommentsContext(): CommentsContextValue {
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

// ── Reply ────────────────────────────────────────────────────────────────────

export const ReplyRootContext = createContext<UseReplyReturn | null>(null);

export function useReplyContext(): UseReplyReturn {
  const ctx = useContext(ReplyRootContext);
  if (!ctx) throw new Error("This part must be rendered inside <Reply.Root>.");
  return ctx;
}

// ── Editor ───────────────────────────────────────────────────────────────────

export const EditorRootContext = createContext<UseEditorReturn | null>(null);

export function useEditorContext(): UseEditorReturn {
  const ctx = useContext(EditorRootContext);
  if (!ctx) throw new Error("This part must be rendered inside <Editor.Root>.");
  return ctx;
}
