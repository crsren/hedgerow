import {
  createSocialActor,
  SOCIAL_SCOPE,
  type BrowserSession,
  type SocialActor,
} from "@hedgerow/reader";

/** Permissions for signed-in replies, likes and profile display. */
export const permissionScope = SOCIAL_SCOPE;

/** Bind a browser session to constrained Bluesky social mutations. */
export function actor(session: BrowserSession): SocialActor {
  return createSocialActor(session);
}

export {
  HedgerowFetchError,
  atUriToBskyUrl,
  fetchLikes,
  fetchThread,
  resolvePostUri,
  sortReplies,
} from "@hedgerow/comments";

export type {
  Actor,
  BlockedNode,
  Comment,
  CommentNode,
  FetchLikesOpts,
  FetchThreadOpts,
  Like,
  LikesResult,
  NotFoundNode,
  PostStats,
  ResolveOpts,
  SortOrder,
  ThreadResult,
} from "@hedgerow/comments";

export type { CreateReplyInput, SocialActor, StrongRef } from "@hedgerow/reader";
