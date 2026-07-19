// Record shapes for the two standard.site lexicons we publish. Hand-written to
// mirror the vendored JSON in ./lexicons — deliberately narrow (only the fields
// v0 uses), not the full codegen tree. See NOTES / docs for why textContent is
// the only portable body field in the current lexicon version.

export const PUBLICATION_NSID = "site.standard.publication" as const;
export const DOCUMENT_NSID = "site.standard.document" as const;
/** The Bluesky post collection — share posts and comment anchors live here. */
export const BSKY_POST_NSID = "app.bsky.feed.post" as const;

/** strongRef (com.atproto.repo.strongRef): a specific, verified record. */
export interface StrongRef {
  uri: string;
  cid: string;
}

/** site.standard.publication — the site itself (key: "tid", one per site). */
export interface PublicationRecord {
  $type: typeof PUBLICATION_NSID;
  /** Canonical site URL, no trailing slash. Required. */
  url: string;
  /** Display name, ≤500 graphemes. Required. */
  name: string;
  /** ≤3000 graphemes. */
  description?: string;
}

/** site.standard.document — one published post (key: "tid"). */
export interface DocumentRecord {
  $type: typeof DOCUMENT_NSID;
  /** at:// ref to the publication record, or a plain https:// publication URL. Required. */
  site: string;
  /** ≤500 graphemes. Required. */
  title: string;
  /** ISO datetime. Required. */
  publishedAt: string;
  /** Leading slash; site.url + path = canonical URL. */
  path?: string;
  description?: string;
  tags?: string[];
  updatedAt?: string;
  /**
   * Plaintext body. The lexicon's `content` field is an open union with NO
   * members in this version, so this plaintext mirror is the only portable,
   * always-renderable body. Rich markdown stays in-repo and renders locally.
   */
  textContent?: string;
  /**
   * strongRef to the Bluesky post that hosts this document's comment thread.
   * The lexicon's built-in comment anchor (see SLIMS-55): the canonical thread
   * is a real Bluesky post, not the document record itself.
   */
  bskyPostRef?: StrongRef;
}
