// Two layers of types:
//   1. The raw AppView lexicon shapes we read (`Raw*`) — deliberately narrow,
//      only the fields we consume, hand-written to mirror app.bsky.feed.defs.
//   2. The clean, framework-agnostic shapes we hand to renderers (CommentNode
//      tree, ThreadResult, LikesResult) — a stable surface that hides the
//      lexicon's `$type` discriminators and optional-count quirks.

// ── Raw AppView shapes (normalization input) ─────────────────────────────────

/** app.bsky.actor.defs#profileViewBasic (subset). */
export interface RawAuthor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  labels?: RawLabel[];
}

/** com.atproto.label.defs#label — a moderation label. Passed through untouched. */
export interface RawLabel {
  src: string;
  uri: string;
  cid?: string;
  val: string;
  neg?: boolean;
  cts?: string;
  exp?: string;
  ver?: number;
}

/** The app.bsky.feed.post record body (subset). */
export interface RawPostRecord {
  $type?: string;
  text?: string;
  createdAt?: string;
  [k: string]: unknown;
}

/** app.bsky.feed.defs#postView (subset). */
export interface RawPostView {
  uri: string;
  cid: string;
  author: RawAuthor;
  record: RawPostRecord;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
  labels?: RawLabel[];
}

export const THREAD_VIEW_POST = "app.bsky.feed.defs#threadViewPost" as const;
export const NOT_FOUND_POST = "app.bsky.feed.defs#notFoundPost" as const;
export const BLOCKED_POST = "app.bsky.feed.defs#blockedPost" as const;

/** app.bsky.feed.defs#threadViewPost (subset). */
export interface RawThreadViewPost {
  $type?: typeof THREAD_VIEW_POST;
  post: RawPostView;
  parent?: RawThreadNode;
  replies?: RawThreadNode[];
}

/** app.bsky.feed.defs#notFoundPost. */
export interface RawNotFoundPost {
  $type: typeof NOT_FOUND_POST;
  uri: string;
  notFound: true;
}

/** app.bsky.feed.defs#blockedPost. */
export interface RawBlockedPost {
  $type: typeof BLOCKED_POST;
  uri: string;
  blocked: true;
  author?: { did: string };
}

/** A node in the raw thread: a real post, or a not-found / blocked stub. */
export type RawThreadNode = RawThreadViewPost | RawNotFoundPost | RawBlockedPost;

/** Response of app.bsky.feed.getPostThread. */
export interface RawGetPostThreadResponse {
  thread: RawThreadNode;
}

/** app.bsky.feed.getLikes#like — one like with the actor who made it. */
export interface RawLike {
  createdAt?: string;
  indexedAt?: string;
  actor: RawAuthor;
}

/** Response of app.bsky.feed.getLikes. */
export interface RawGetLikesResponse {
  uri: string;
  cursor?: string;
  likes: RawLike[];
}

// ── Clean output shapes (what renderers consume) ─────────────────────────────

/** A comment author / like actor, flattened from the profile view. */
export interface Actor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/** A moderation label, re-exported unchanged so renderers can decide policy. */
export type Label = RawLabel;

/** Discriminated union of a thread node. Stubs never crash a render. */
export type CommentNode = Comment | NotFoundNode | BlockedNode;

export interface Comment {
  type: "comment";
  uri: string;
  cid: string;
  author: Actor;
  text: string;
  /** ISO datetime from the post record. */
  createdAt: string;
  /** ISO datetime the AppView indexed the post, when present. */
  indexedAt?: string;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  /** Moderation labels on the post AND its author, merged. Never filtered. */
  labels: Label[];
  /** Direct replies, already normalized and depth-capped. */
  replies: CommentNode[];
  /** bsky.app web URL for this comment ("view on Bluesky"). */
  url: string;
}

/** A reply the AppView could not return (deleted / detached). */
export interface NotFoundNode {
  type: "notFound";
  uri: string;
}

/** A reply hidden by a block relationship. */
export interface BlockedNode {
  type: "blocked";
  uri: string;
  /** did of the blocked author, when the AppView disclosed it. */
  authorDid?: string;
}

/** Engagement counts on the root post. */
export interface PostStats {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
}

export interface ThreadResult {
  /** Canonical at:// URI of the root post (with DID). */
  uri: string;
  /** Root node with its reply tree. May itself be a notFound/blocked stub. */
  post: CommentNode;
  /** Root post engagement counts (all zero when `post` is a stub). */
  stats: PostStats;
  /** bsky.app web URL of the root post — the "reply on Bluesky" link. */
  postUrl: string;
}

/** An actor who liked the post, plus when. */
export interface Like {
  actor: Actor;
  /** ISO datetime the like was created, when present. */
  createdAt?: string;
  indexedAt?: string;
}

export interface LikesResult {
  /** at:// URI the likes were fetched for. */
  uri: string;
  likes: Like[];
  /**
   * Number of likes collected. This is the count actually fetched (capped by
   * `maxPages`), which can be fewer than the post's full likeCount.
   */
  total: number;
  /** Cursor for the next page, or undefined when fully paged / capped out. */
  cursor?: string;
}
