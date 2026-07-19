// Normalize any of the ways a Bluesky post gets referenced into one canonical
// at:// URI that always carries a DID (not a handle):
//   - at://did:plc:.../app.bsky.feed.post/rkey   → pass through
//   - at://handle/app.bsky.feed.post/rkey        → resolve handle → DID
//   - https://bsky.app/profile/{handleOrDid}/post/{rkey} → build + resolve
// Handle→DID resolutions are memoized in a module-level Map with a simple TTL.
import { DEFAULT_APPVIEW, POST_COLLECTION, xrpcGet } from "./xrpc.js";
import { HedgerowFetchError } from "./errors.js";

export interface ResolveOpts {
  /** Injectable fetch (for tests / custom environments). Defaults to global. */
  fetchImpl?: typeof fetch;
  /** AppView base URL. Defaults to the public one. */
  appView?: string;
  /** Handle→DID cache TTL in ms. Defaults to 5 minutes. Use 0 to disable. */
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

// Module-level cache. Keyed by lowercased handle. A single shared clock via
// Date.now keeps this dependency-free; a real app rarely needs an injectable
// clock here since entries are short-lived and identity-stable.
const handleCache = new Map<string, { did: string; expires: number }>();

/** Clear the handle→DID cache. Exposed mainly for tests. */
export function clearHandleCache(): void {
  handleCache.clear();
}

/** Resolve a handle to a DID via com.atproto.identity.resolveHandle, memoized. */
export async function resolveHandle(handle: string, opts: ResolveOpts = {}): Promise<string> {
  const key = handle.toLowerCase();
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();

  const hit = handleCache.get(key);
  if (hit && hit.expires > now) return hit.did;

  const { did } = await xrpcGet<{ did: string }>(
    opts.appView ?? DEFAULT_APPVIEW,
    "com.atproto.identity.resolveHandle",
    { handle },
    opts.fetchImpl,
  );

  if (ttl > 0) handleCache.set(key, { did, expires: now + ttl });
  return did;
}

/** Parsed pieces of a post reference. */
interface ParsedRef {
  /** A DID (did:...) or a handle — resolution happens after parsing. */
  authority: string;
  rkey: string;
}

const AT_URI_RE = new RegExp(`^at://([^/]+)/${POST_COLLECTION.replace(/\./g, "\\.")}/([^/?#]+)`);
const BSKY_URL_RE = /^https?:\/\/(?:[^/]*\.)?bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/;

function parseRef(input: string): ParsedRef {
  const trimmed = input.trim();

  const at = AT_URI_RE.exec(trimmed);
  if (at) return { authority: at[1]!, rkey: at[2]! };

  const url = BSKY_URL_RE.exec(trimmed);
  if (url) return { authority: decodeURIComponent(url[1]!), rkey: url[2]! };

  throw new HedgerowFetchError(`Unrecognized post reference: ${input}`, {
    status: 0,
    method: "resolvePostUri",
  });
}

/**
 * Normalize any supported post reference to a canonical at:// URI whose
 * authority is a DID. If the reference already uses a DID, no network call is
 * made; a handle triggers one resolveHandle (memoized).
 */
export async function resolvePostUri(input: string, opts: ResolveOpts = {}): Promise<string> {
  const { authority, rkey } = parseRef(input);
  const did = authority.startsWith("did:") ? authority : await resolveHandle(authority, opts);
  return `at://${did}/${POST_COLLECTION}/${rkey}`;
}

/**
 * Build the bsky.app web URL for a post at:// URI (the "view/reply on Bluesky"
 * link). Uses the DID or handle as-is — bsky.app resolves either.
 */
export function atUriToBskyUrl(atUri: string): string {
  const at = AT_URI_RE.exec(atUri);
  if (!at) throw new HedgerowFetchError(`Not a post at:// URI: ${atUri}`, { status: 0 });
  return `https://bsky.app/profile/${at[1]}/post/${at[2]}`;
}
