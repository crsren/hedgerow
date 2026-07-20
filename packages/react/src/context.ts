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

/**
 * `useComments`'s return, plus the three purely-UI per-verb callback props
 * `Comments.Root` takes to wire per-comment like/unlike/reply triggers — kept
 * OUT of `useComments` itself (which stays a pure fetch/sort/optimistic-merge
 * engine) since these are just passed straight through from props to context
 * for `Comments.LikeButton`/`Comments.ReplyButton` to read. Splitting the old
 * single `onCommentAction(action, node)` into three optional, independently
 * omittable props means `Comments.ReplyButton` (which needs only
 * `onReplyToComment`) can render without a consumer having to also decide
 * what "like" means, and vice versa. All three are optional and `undefined`
 * disables/unrenders the parts that need them — same "injected, not
 * imported" contract `Reply.Root`'s `session`/`onSubmit` use, so `@hedgerow/react`
 * still never imports `@hedgerow/reader` or any other auth library.
 */
export interface CommentsContextValue extends UseCommentsReturn {
  /** Like `node`. A rejection rolls `Comments.LikeButton`'s optimistic toggle back — same contract as `useLikeButton`'s `onLike`. */
  onLikeComment?: (node: Comment) => void | Promise<void>;
  /** Unlike `node`. A rejection rolls the optimistic toggle back — same contract as `useLikeButton`'s `onUnlike`. */
  onUnlikeComment?: (node: Comment) => void | Promise<void>;
  /** "Reply to this comment" was triggered. `Comments.ReplyButton` renders only when this is set — see its own doc comment. */
  onReplyToComment?: (node: Comment) => void | Promise<void>;
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
export interface CommentsItemContextValue {
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

export const CommentItemContext = createContext<CommentsItemContextValue | null>(null);

export function useCommentItemContext(): CommentsItemContextValue {
  const ctx = useContext(CommentItemContext);
  if (!ctx) throw new Error("This part must be rendered inside <Comments.Item>.");
  return ctx;
}

/** Non-throwing accessor — for parts (e.g. ReplyLink) usable in or out of an item. */
export function useOptionalCommentItem(): CommentsItemContextValue | null {
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
