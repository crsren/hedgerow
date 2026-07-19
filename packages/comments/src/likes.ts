// Fetch app.bsky.feed.getLikes, paging the cursor up to a cap. getLikes gives
// no grand total — only pages of actors — so `total` here is the number we
// actually collected (bounded by maxPages * pageSize).
import { DEFAULT_APPVIEW, xrpcGet } from "./xrpc.js";
import { resolvePostUri, type ResolveOpts } from "./resolve.js";
import type { Like, LikesResult, RawGetLikesResponse } from "./types.js";

export interface FetchLikesOpts extends ResolveOpts {
  /** Actors per page (getLikes max is 100). Default 100. */
  pageSize?: number;
  /** Max pages to fetch before stopping. Default 5 (→ up to 500 likes). */
  maxPages?: number;
  /** Skip resolvePostUri when `input` is already a canonical at:// URI. */
  preResolved?: boolean;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;

/**
 * Page a post's likes into a flat, deduped-by-page actor list. Stops at the
 * page cap or when the AppView returns no further cursor, whichever comes first;
 * the returned `cursor` is non-undefined only when more likes remain uncollected.
 */
export async function fetchLikes(input: string, opts: FetchLikesOpts = {}): Promise<LikesResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);
  const maxPages = Math.max(opts.maxPages ?? DEFAULT_MAX_PAGES, 1);
  const uri = opts.preResolved ? input.trim() : await resolvePostUri(input, opts);

  const likes: Like[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const res = await xrpcGet<RawGetLikesResponse>(
      opts.appView ?? DEFAULT_APPVIEW,
      "app.bsky.feed.getLikes",
      { uri, limit: pageSize, cursor },
      opts.fetchImpl,
    );
    for (const like of res.likes) {
      likes.push({
        actor: {
          did: like.actor.did,
          handle: like.actor.handle,
          displayName: like.actor.displayName,
          avatar: like.actor.avatar,
        },
        createdAt: like.createdAt,
        indexedAt: like.indexedAt,
      });
    }
    cursor = res.cursor;
    pages += 1;
  } while (cursor && pages < maxPages);

  return { uri, likes, total: likes.length, cursor };
}
