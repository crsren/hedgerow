// API report for @hedgerow/comments — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

declare class HedgerowFetchError extends Error {
    readonly status: number;
    readonly network: boolean;
    readonly xrpcError?: string;
    readonly xrpcMessage?: string;
    readonly method?: string;
    readonly cause?: unknown;
    constructor(message: string, opts: {
        status: number;
        network?: boolean;
        xrpcError?: string;
        xrpcMessage?: string;
        method?: string;
        cause?: unknown;
    });
    get isNotFound(): boolean;
}
interface RawAuthor {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
    labels?: RawLabel[];
}
interface RawLabel {
    src: string;
    uri: string;
    cid?: string;
    val: string;
    neg?: boolean;
    cts?: string;
    exp?: string;
    ver?: number;
}
interface RawPostRecord {
    $type?: string;
    text?: string;
    createdAt?: string;
    [k: string]: unknown;
}
interface RawPostView {
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
declare const THREAD_VIEW_POST: "app.bsky.feed.defs#threadViewPost";
declare const NOT_FOUND_POST: "app.bsky.feed.defs#notFoundPost";
declare const BLOCKED_POST: "app.bsky.feed.defs#blockedPost";
interface RawThreadViewPost {
    $type?: typeof THREAD_VIEW_POST;
    post: RawPostView;
    parent?: RawThreadNode;
    replies?: RawThreadNode[];
}
interface RawNotFoundPost {
    $type: typeof NOT_FOUND_POST;
    uri: string;
    notFound: true;
}
interface RawBlockedPost {
    $type: typeof BLOCKED_POST;
    uri: string;
    blocked: true;
    author?: {
        did: string;
    };
}
type RawThreadNode = RawThreadViewPost | RawNotFoundPost | RawBlockedPost;
interface RawGetPostThreadResponse {
    thread: RawThreadNode;
}
interface RawLike {
    createdAt?: string;
    indexedAt?: string;
    actor: RawAuthor;
}
interface RawGetLikesResponse {
    uri: string;
    cursor?: string;
    likes: RawLike[];
}
interface Actor {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
}
type Label = RawLabel;
type CommentNode = Comment | NotFoundNode | BlockedNode;
interface Comment {
    type: "comment";
    uri: string;
    cid: string;
    author: Actor;
    text: string;
    createdAt: string;
    indexedAt?: string;
    likeCount: number;
    replyCount: number;
    repostCount: number;
    labels: Label[];
    replies: CommentNode[];
    url: string;
}
interface NotFoundNode {
    type: "notFound";
    uri: string;
}
interface BlockedNode {
    type: "blocked";
    uri: string;
    authorDid?: string;
}
interface PostStats {
    likeCount: number;
    repostCount: number;
    replyCount: number;
    quoteCount: number;
}
interface ThreadResult {
    uri: string;
    post: CommentNode;
    stats: PostStats;
    postUrl: string;
}
interface Like {
    actor: Actor;
    createdAt?: string;
    indexedAt?: string;
}
interface LikesResult {
    uri: string;
    likes: Like[];
    total: number;
    cursor?: string;
}
declare const DEFAULT_APPVIEW = "https://public.api.bsky.app";
declare const POST_COLLECTION = "app.bsky.feed.post";
type XrpcParams = Record<string, string | number | boolean | undefined>;
declare function xrpcGet<T>(baseUrl: string, method: string, params: XrpcParams, fetchImpl?: typeof fetch): Promise<T>;
interface ResolveOpts {
    fetchImpl?: typeof fetch;
    appView?: string;
    cacheTtlMs?: number;
}
declare function clearHandleCache(): void;
declare function resolveHandle(handle: string, opts?: ResolveOpts): Promise<string>;
declare function resolvePostUri(input: string, opts?: ResolveOpts): Promise<string>;
declare function atUriToBskyUrl(atUri: string): string;
interface FetchThreadOpts extends ResolveOpts {
    maxDepth?: number;
    preResolved?: boolean;
}
declare function fetchThread(input: string, opts?: FetchThreadOpts): Promise<ThreadResult>;
interface FetchLikesOpts extends ResolveOpts {
    pageSize?: number;
    maxPages?: number;
    preResolved?: boolean;
}
declare function fetchLikes(input: string, opts?: FetchLikesOpts): Promise<LikesResult>;
type SortOrder = "newest" | "oldest" | "most-liked";
declare function sortReplies(nodes: CommentNode[], order: SortOrder): CommentNode[];
export { type Actor, BLOCKED_POST, type BlockedNode, type Comment, type CommentNode, DEFAULT_APPVIEW, type FetchLikesOpts, type FetchThreadOpts, HedgerowFetchError, type Label, type Like, type LikesResult, NOT_FOUND_POST, type NotFoundNode, POST_COLLECTION, type PostStats, type RawAuthor, type RawBlockedPost, type RawGetLikesResponse, type RawGetPostThreadResponse, type RawLabel, type RawLike, type RawNotFoundPost, type RawPostRecord, type RawPostView, type RawThreadNode, type RawThreadViewPost, type ResolveOpts, type SortOrder, THREAD_VIEW_POST, type ThreadResult, type XrpcParams, atUriToBskyUrl, clearHandleCache, fetchLikes, fetchThread, resolveHandle, resolvePostUri, sortReplies, xrpcGet };
