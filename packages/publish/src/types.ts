// Record shapes for the two standard.site lexicons we publish. Hand-written to
// mirror the vendored JSON in ./lexicons — deliberately narrow (only the fields
// v0 uses), not the full codegen tree. See NOTES / docs for why textContent is
// the only portable body field in the current lexicon version.

export const PUBLICATION_NSID = "site.standard.publication" as const;
export const DOCUMENT_NSID = "site.standard.document" as const;
/** The Bluesky post collection — share posts and comment anchors live here. */
export const BSKY_POST_NSID = "app.bsky.feed.post" as const;
/**
 * pub.hedgerow.content.markdown (SLIMS-64) — the one member Hedgerow writes
 * into site.standard.document's open `content` union. See
 * ./lexicons/pub/hedgerow/content/markdown.json for the vendored schema.
 */
export const MARKDOWN_CONTENT_NSID = "pub.hedgerow.content.markdown" as const;

/** strongRef (com.atproto.repo.strongRef): a specific, verified record. */
export interface StrongRef {
  uri: string;
  cid: string;
}

/** com.atproto blob ref shape, as embedded in a MarkdownContent's `blobs`. */
export interface BlobRef {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

/**
 * pub.hedgerow.content.markdown — rich body as markdown. `blobs` is unused in
 * v1 (embedded images aren't uploaded yet) but present so a future version
 * can pin them without a schema migration.
 */
export interface MarkdownContent {
  $type: typeof MARKDOWN_CONTENT_NSID;
  markdown: string;
  blobs?: BlobRef[];
}

/**
 * site.standard.document's `content` field: an open union (no members in the
 * lexicon's own `refs`, `closed: false`) — `pub.hedgerow.content.markdown` is
 * the one member Hedgerow writes today. A `DocumentRecord` with a `content`
 * member ALWAYS also carries a `textContent` plaintext mirror (see below), so
 * a plain standard.site reader that doesn't know this member still renders.
 */
export type DocumentContent = MarkdownContent;

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
   * Rich body (SLIMS-64): a member of the lexicon's open `content` union —
   * `pub.hedgerow.content.markdown` today. Optional: older/loose documents
   * may carry only `textContent`.
   */
  content?: DocumentContent;
  /**
   * Plaintext mirror of the body. ALWAYS present alongside `content` (see
   * above) so a standard.site reader with no knowledge of the `content`
   * member still renders something — this is the only field every consumer
   * can trust.
   */
  textContent?: string;
  /**
   * strongRef to the Bluesky post that hosts this document's comment thread.
   * The lexicon's built-in comment anchor (see SLIMS-55): the canonical thread
   * is a real Bluesky post, not the document record itself.
   */
  bskyPostRef?: StrongRef;
}
