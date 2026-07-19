// @hedgerow/react — headless React components and hooks for Bluesky comments
// and likes. Two composable namespaces (`Comments.*`, `Likes.*`) built as thin
// shells over two hooks (`useComments`, `useLikes`). No styles ship: parts
// render default elements you restyle via className/style/render and data-*.

import {
  Root as CommentsRoot,
  List,
  Item,
  Replies,
  Author,
  Avatar as CommentsAvatar,
  Content,
  Timestamp,
  Likes as CommentLikes,
  Labels,
  Fallback,
  Stats,
  ReplyLink,
  Loading as CommentsLoading,
  ErrorMessage as CommentsError,
  Empty as CommentsEmpty,
} from "./comments";
import {
  Root as LikesRoot,
  Count,
  Avatars,
  Avatar as LikeAvatar,
  Loading as LikesLoading,
  Empty as LikesEmpty,
  ErrorMessage as LikesError,
} from "./likes";

/**
 * Comment thread parts. `Root` provides state; the rest read it. `Item` is the
 * per-comment template that `List` and `Replies` repeat.
 */
export const Comments = {
  Root: CommentsRoot,
  List,
  Item,
  Replies,
  Author,
  Avatar: CommentsAvatar,
  Content,
  Timestamp,
  /** The comment's own like count (not to be confused with the `Likes.*` namespace). */
  Likes: CommentLikes,
  Labels,
  Fallback,
  Stats,
  ReplyLink,
  Loading: CommentsLoading,
  Error: CommentsError,
  Empty: CommentsEmpty,
} as const;

/** Post-likes parts: `Root` provides state; `Count`/`Avatars` read it. */
export const Likes = {
  Root: LikesRoot,
  Count,
  Avatars,
  Avatar: LikeAvatar,
  Loading: LikesLoading,
  Empty: LikesEmpty,
  Error: LikesError,
} as const;

// ── Hooks (the headless core; usable without any component) ───────────────────
export { useComments } from "./useComments";
export { useLikes } from "./useLikes";
export { useCommentNode } from "./hooks";
export {
  useCommentsContext,
  useCommentItemContext,
  useOptionalCommentItem,
  useLikesContext,
  useLikeItemContext,
} from "./context";

// ── Render primitive (for building your own custom parts) ─────────────────────
export { renderElement, mergeRefs, dataAttrs } from "./render";

// ── Types ─────────────────────────────────────────────────────────────────────
export type { UseCommentsOptions, UseCommentsReturn, RequestStatus } from "./useComments";
export type { UseLikesOptions, UseLikesReturn } from "./useLikes";
export type { CommentItemContextValue } from "./context";
export type {
  HeadlessProps,
  RenderProp,
  RenderFnProps,
  ClassNameProp,
  StyleProp,
} from "./render";
export type {
  PartProps,
  CommentsRootState,
  CommentsRootProps,
  CommentsListState,
  CommentsListProps,
  CommentItemState,
  CommentItemProps,
  CommentsRepliesState,
  CommentsRepliesProps,
  AuthorState,
  CommentsAuthorProps,
  CommentsAvatarProps,
  ContentState,
  CommentsContentProps,
  TimestampState,
  CommentsTimestampProps,
  LikesState,
  CommentsLikesProps,
  LabelsState,
  CommentsLabelsProps,
  FallbackState,
  CommentsFallbackProps,
  StatsState,
  CommentsStatsProps,
  ReplyLinkState,
  CommentsReplyLinkProps,
  CommentsLoadingProps,
  CommentsErrorState,
  CommentsErrorProps,
  CommentsEmptyProps,
} from "./comments";
export type {
  LikesRootState,
  LikesRootProps,
  LikesCountState,
  LikesCountProps,
  LikesAvatarsState,
  LikesAvatarsProps,
  LikeAvatarState,
  LikeAvatarProps,
  LikesLoadingProps,
  LikesEmptyProps,
  LikesErrorState,
  LikesErrorProps,
} from "./likes";

// Re-export the read core's public shapes so consumers need only one import.
export {
  HedgerowFetchError,
  resolvePostUri,
  atUriToBskyUrl,
  sortReplies,
} from "@hedgerow/comments";
export type {
  CommentNode,
  Comment,
  NotFoundNode,
  BlockedNode,
  Actor,
  Label,
  ThreadResult,
  PostStats,
  Like,
  LikesResult,
  SortOrder,
} from "@hedgerow/comments";
