// Resolve a Bluesky post reference (an at-uri or a bsky.app share URL) to a
// verified StrongRef {uri, cid}. This is what turns the interim, author-friendly
// `bskyPostUri` convention into the proper `bskyPostRef` anchor on a document
// record (SLIMS-55): the frontmatter carries a bare link to the canonical
// Bluesky post; publishSite resolves its current cid here before writing.
import { resolveDid, resolvePds } from "./read.js";
import type { StrongRef } from "./types.js";

const POST_COLLECTION = "app.bsky.feed.post";

export interface ResolveBskyPostRefOptions {
  /**
   * PDS endpoint override. When set, the post author's DID document is NOT
   * resolved for its #atproto_pds endpoint — getRecord hits this PDS directly.
   * Mainly for tests / a known local PDS.
   */
  pds?: string;
  fetchImpl?: typeof fetch;
}

/** The post author (a DID or a handle) and the record key, pulled from a uri/url. */
export interface ParsedBskyPostUri {
  authority: string;
  rkey: string;
}

/**
 * Normalize an `at://…/app.bsky.feed.post/<rkey>` uri or a
 * `https://bsky.app/profile/<handleOrDid>/post/<rkey>` URL to {authority, rkey}.
 * Throws on anything that isn't one of those two shapes.
 */
export function parseBskyPostUri(uriOrUrl: string): ParsedBskyPostUri {
  const input = uriOrUrl.trim();

  if (input.startsWith("at://")) {
    const [authority, collection, rkey] = input.slice("at://".length).split("/");
    if (!authority || collection !== POST_COLLECTION || !rkey) {
      throw new Error(`not an ${POST_COLLECTION} at-uri: ${uriOrUrl}`);
    }
    return { authority, rkey };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`not a valid bsky post uri or url: ${uriOrUrl}`);
  }
  // /profile/<handleOrDid>/post/<rkey>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "profile" && parts[2] === "post" && parts[1] && parts[3]) {
    return { authority: parts[1], rkey: parts[3] };
  }
  throw new Error(`not a recognized bsky.app post url: ${uriOrUrl}`);
}

/**
 * Resolve a Bluesky post uri/url to a StrongRef, fetching the current cid via an
 * unauthenticated `com.atproto.repo.getRecord` on the POST AUTHOR's PDS. The
 * returned `uri` is always the canonical at-uri with the author's DID (a handle
 * in the input is resolved to a DID), so the ref stays stable across renames.
 */
export async function resolveBskyPostRef(
  uriOrUrl: string,
  opts: ResolveBskyPostRefOptions = {},
): Promise<StrongRef> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { authority, rkey } = parseBskyPostUri(uriOrUrl);

  const did = await resolveDid(authority, fetchImpl);
  const pds = opts.pds ?? (await resolvePds(did, fetchImpl)).pds;

  const u = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
  u.searchParams.set("repo", did);
  u.searchParams.set("collection", POST_COLLECTION);
  u.searchParams.set("rkey", rkey);
  const res = await fetchImpl(u);
  if (!res.ok) {
    throw new Error(
      `bsky post ${did}/${rkey} not found (getRecord ${res.status}) — deleted, or wrong PDS?`,
    );
  }
  const data = (await res.json()) as { uri?: string; cid?: string };
  if (!data.cid) throw new Error(`getRecord for ${did}/${rkey} returned no cid`);
  return { uri: `at://${did}/${POST_COLLECTION}/${rkey}`, cid: data.cid };
}
