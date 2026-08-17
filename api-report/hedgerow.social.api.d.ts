// API report for hedgerow — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

import { BrowserSession, SocialActor } from "@hedgerow/reader";
export { CreateReplyInput, SocialActor, StrongRef } from "@hedgerow/reader";
export { Actor, BlockedNode, Comment, CommentNode, FetchLikesOpts, FetchThreadOpts, HedgerowFetchError, Like, LikesResult, NotFoundNode, PostStats, ResolveOpts, SortOrder, ThreadResult, atUriToBskyUrl, fetchLikes, fetchThread, resolvePostUri, sortReplies } from "@hedgerow/comments";
declare const permissionScope: string;
declare function actor(session: BrowserSession): SocialActor;
export { actor, permissionScope };
