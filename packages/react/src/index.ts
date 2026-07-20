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
  LikeButton as CommentsLikeButton,
  ReplyButton as CommentsReplyButton,
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
  Button as LikesButton,
  Avatars,
  Avatar as LikeAvatar,
  Loading as LikesLoading,
  Empty as LikesEmpty,
  ErrorMessage as LikesError,
} from "./likes";
import {
  Root as ReplyRoot,
  Field as ReplyField,
  Submit as ReplySubmit,
  SignedIn as ReplySignedIn,
  SignedOut as ReplySignedOut,
  ErrorMessage as ReplyError,
} from "./reply";

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
  /** Like/unlike toggle for this comment — see `Comments.Root`'s `onCommentAction`/`isCommentLiked`. */
  LikeButton: CommentsLikeButton,
  /** "Reply to this comment" trigger — see `Comments.Root`'s `onCommentAction`. */
  ReplyButton: CommentsReplyButton,
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
  /** Standalone like/unlike toggle for the post — no `Likes.Root` needed, see likes.tsx. */
  Button: LikesButton,
  Avatars,
  Avatar: LikeAvatar,
  Loading: LikesLoading,
  Empty: LikesEmpty,
  Error: LikesError,
} as const;

/**
 * Reply composer parts: `Root` takes `session` + `onSubmit` (both injected —
 * no dependency on @hedgerow/reader or any other auth library) and runs the
 * submit state machine; the rest read it. `SignedIn`/`SignedOut` are
 * conditional slots on `session`.
 */
export const Reply = {
  Root: ReplyRoot,
  Field: ReplyField,
  Submit: ReplySubmit,
  SignedIn: ReplySignedIn,
  SignedOut: ReplySignedOut,
  Error: ReplyError,
} as const;

// ── Hooks (the headless core; usable without any component) ───────────────────
export { useComments } from "./useComments";
export { useLikes } from "./useLikes";
export { useReply } from "./useReply";
export { useLikeButton } from "./useLikeButton";
export { useCommentNode } from "./hooks";
export {
  useCommentsContext,
  useCommentItemContext,
  useOptionalCommentItem,
  useLikesContext,
  useLikeItemContext,
  useReplyContext,
} from "./context";

// ── Render primitive (for building your own custom parts) ─────────────────────
export { renderElement, mergeRefs, dataAttrs } from "./render";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  UseCommentsOptions,
  UseCommentsReturn,
  RequestStatus,
  DeliveryState,
  OptimisticReplyInput,
} from "./useComments";
export type { UseLikesOptions, UseLikesReturn } from "./useLikes";
export type { UseLikeButtonOptions, UseLikeButtonReturn } from "./useLikeButton";
export type { CommentItemContextValue, CommentAction, CommentsContextValue } from "./context";
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
  CommentsLikeButtonState,
  CommentsLikeButtonProps,
  CommentsReplyButtonState,
  CommentsReplyButtonProps,
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
  LikeButtonState,
  LikeButtonProps,
  LikesAvatarsState,
  LikesAvatarsProps,
  LikeAvatarState,
  LikeAvatarProps,
  LikesLoadingProps,
  LikesEmptyProps,
  LikesErrorState,
  LikesErrorProps,
} from "./likes";
export type {
  ReplyRootState,
  ReplyRootProps,
  ReplyFieldState,
  ReplyFieldProps,
  ReplySubmitState,
  ReplySubmitProps,
  ReplySignedInProps,
  ReplySignedOutProps,
  ReplyErrorState,
  ReplyErrorProps,
} from "./reply";
export type { ReplyStatus, ReplySession, UseReplyOptions, UseReplyReturn } from "./useReply";

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
