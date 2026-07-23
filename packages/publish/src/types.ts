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

/**
 * Key of the tool-attribution stamp we add to every document (SLIMS-71).
 *
 * Reverse-DNS rather than a bare `via`, for one reason: `via` is exactly the
 * name standard.site would reach for if it ever adds tool attribution of its
 * own, and a collision there would mean our string sitting in a field the
 * lexicon declares as some other type — in every adopter's repo, on records we
 * can't reach. atproto has no blessed convention for third-party extra keys
 * (the lexicon spec floats `x-` as a POSSIBLE FUTURE mechanism, and `$`
 * prefixes are reserved for the protocol), so a namespace we already own is
 * the only collision-proof option available.
 *
 * Safe to add because unknown fields are carried, not stripped: PDSes don't
 * validate against lexicons at all, and the lexicon spec says consumers should
 * ignore fields they don't recognise. So this is inert to every reader except
 * one looking for it. See https://atproto.com/specs/lexicon.
 */
export const VIA_KEY = "pub.hedgerow.via" as const;

/**
 * Value of that stamp: the tool, deliberately WITHOUT a version.
 *
 * A version here would be re-stamped on every release, and since `publishSite`
 * decides whether to write by comparing the record it built against the live
 * one, that would rewrite every document and bump every `updatedAt` each time
 * a consumer upgraded — turning a dependency bump into "all my posts were
 * edited today". The stamp answers "what published this", not "which build".
 */
export const VIA_VALUE = "@hedgerow/publish" as const;

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
  /**
   * Tool attribution — `"@hedgerow/publish"`, stamped on every document we
   * write (SLIMS-71). Not part of the standard.site lexicon; it rides along as
   * an extra field so a reader can tell hedgerow-published documents apart
   * from any other standard.site producer. See {@link VIA_KEY} for why the key
   * is namespaced and {@link VIA_VALUE} for why it carries no version.
   *
   * Optional on the type because documents written before this existed (or by
   * another tool) simply don't have it — treat absence as "unknown", never as
   * "not hedgerow".
   */
  [VIA_KEY]?: typeof VIA_VALUE;
}
