// Fetch app.bsky.feed.getPostThread and normalize the raw lexicon tree into a
// clean recursive CommentNode tree. The two hard requirements from the brief:
//   - notFoundPost / blockedPost stubs become explicit placeholder nodes,
//     never crashes;
//   - depth is capped both by asking the AppView for `maxDepth` levels AND by
//     defensively truncating during normalization.
import { DEFAULT_APPVIEW, xrpcGet } from "./xrpc.js";
import { atUriToBskyUrl, resolvePostUri, type ResolveOpts } from "./resolve.js";
import {
  BLOCKED_POST,
  NOT_FOUND_POST,
  type CommentNode,
  type Label,
  type PostStats,
  type RawBlockedPost,
  type RawGetPostThreadResponse,
  type RawLabel,
  type RawNotFoundPost,
  type RawPostView,
  type RawThreadNode,
  type RawThreadViewPost,
  type ThreadResult,
} from "./types.js";

export interface FetchThreadOpts extends ResolveOpts {
  /**
   * Max reply depth to fetch AND keep. Passed to getPostThread's `depth` param
   * and re-enforced during normalization. Default 10.
   */
  maxDepth?: number;
  /**
   * Whether `input` is already a canonical at:// URI with a DID. When true,
   * resolvePostUri is skipped. Default false (always normalize first).
   */
  preResolved?: boolean;
}

const DEFAULT_MAX_DEPTH = 10;
// getPostThread caps depth at 1000; keep our own request within that.
const MAX_SUPPORTED_DEPTH = 1000;

function isNotFound(n: RawThreadNode): n is RawNotFoundPost {
  return (n as RawNotFoundPost).$type === NOT_FOUND_POST;
}
function isBlocked(n: RawThreadNode): n is RawBlockedPost {
  return (n as RawBlockedPost).$type === BLOCKED_POST;
}

/** Merge post-level and author-level moderation labels; never filter them. */
function collectLabels(post: RawPostView): Label[] {
  const out: RawLabel[] = [];
  if (post.labels) out.push(...post.labels);
  if (post.author.labels) out.push(...post.author.labels);
  return out;
}

function normalizePost(view: RawPostView, replies: CommentNode[]): CommentNode {
  return {
    type: "comment",
    uri: view.uri,
    cid: view.cid,
    author: {
      did: view.author.did,
      handle: view.author.handle,
      displayName: view.author.displayName,
      avatar: view.author.avatar,
    },
    text: typeof view.record.text === "string" ? view.record.text : "",
    createdAt: typeof view.record.createdAt === "string" ? view.record.createdAt : "",
    indexedAt: view.indexedAt,
    likeCount: view.likeCount ?? 0,
    replyCount: view.replyCount ?? 0,
    repostCount: view.repostCount ?? 0,
    labels: collectLabels(view),
    replies,
    url: atUriToBskyUrl(view.uri),
  };
}

/**
 * Normalize one raw node into a CommentNode. `depth` is remaining allowed
 * depth: at 0 we keep the node but drop its replies (defensive cap on top of
 * the server-side `depth` param).
 */
function normalizeNode(node: RawThreadNode, depth: number): CommentNode {
  if (isNotFound(node)) return { type: "notFound", uri: node.uri };
  if (isBlocked(node)) return { type: "blocked", uri: node.uri, authorDid: node.author?.did };

  const view = (node as RawThreadViewPost).post;
  const rawReplies = depth > 0 ? ((node as RawThreadViewPost).replies ?? []) : [];
  const replies = rawReplies.map((r) => normalizeNode(r, depth - 1));
  return normalizePost(view, replies);
}

function statsOf(node: CommentNode): PostStats {
  if (node.type !== "comment") {
    return { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 };
  }
  return {
    likeCount: node.likeCount,
    repostCount: node.repostCount,
    replyCount: node.replyCount,
    // quoteCount isn't part of the CommentNode surface; read from the source below.
    quoteCount: 0,
  };
}

/**
 * Fetch and normalize a post's thread. Accepts any reference resolvePostUri
 * understands (or a pre-resolved at:// URI via `preResolved`).
 */
export async function fetchThread(
  input: string,
  opts: FetchThreadOpts = {},
): Promise<ThreadResult> {
  const maxDepth = Math.min(Math.max(opts.maxDepth ?? DEFAULT_MAX_DEPTH, 0), MAX_SUPPORTED_DEPTH);
  const uri = opts.preResolved ? input.trim() : await resolvePostUri(input, opts);

  const res = await xrpcGet<RawGetPostThreadResponse>(
    opts.appView ?? DEFAULT_APPVIEW,
    "app.bsky.feed.getPostThread",
    { uri, depth: maxDepth, parentHeight: 0 },
    opts.fetchImpl,
  );

  const post = normalizeNode(res.thread, maxDepth);

  // Pull quoteCount straight from the raw root view (not on CommentNode).
  const rawRoot = res.thread as RawThreadViewPost;
  const stats = statsOf(post);
  if (post.type === "comment" && typeof rawRoot.post?.quoteCount === "number") {
    stats.quoteCount = rawRoot.post.quoteCount;
  }

  return { uri, post, stats, postUrl: atUriToBskyUrl(uri) };
}
