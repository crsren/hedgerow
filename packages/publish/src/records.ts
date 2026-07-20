// Pure transforms: markdown post -> standard.site records. No I/O, fully unit-testable.
import matter from "gray-matter";
import {
  DOCUMENT_NSID,
  MARKDOWN_CONTENT_NSID,
  PUBLICATION_NSID,
  type DocumentRecord,
  type PublicationRecord,
  type StrongRef,
} from "./types.js";

export interface PublicationConfig {
  /** Canonical site URL. A trailing slash is stripped to satisfy the lexicon. */
  url: string;
  name: string;
  description?: string;
}

export interface ParsedPost {
  slug: string;
  title: string;
  /** ISO datetime. */
  publishedAt: string;
  description?: string;
  tags?: string[];
  /**
   * `draft: true` in frontmatter. `publishSite` skips the post entirely — no
   * document record, no share post — and reports the slug in `skipped`. A draft
   * slug still counts as "kept" for prune, so flipping a live post to draft
   * never deletes its published record (explicit unpublish = delete the file +
   * prune). Absent means not a draft.
   */
  draft?: boolean;
  /**
   * `share: false` in frontmatter opts a post out of auto-share: `publishSite`
   * never MINTS a Bluesky share post for it. An explicit `bskyPostRef` /
   * `bskyPostUri` (and any previously persisted share) is still honored. Absent
   * (or `true`) leaves auto-share on for this post, subject to the run's
   * `share` option.
   */
  share?: boolean;
  /** Raw markdown body (kept for local rich rendering). */
  body: string;
  /** Optional Bluesky post anchor for comments, as a resolved StrongRef (SLIMS-55). */
  bskyPostRef?: StrongRef;
  /**
   * Optional Bluesky post anchor as a bare at-uri or bsky.app URL (SLIMS-55).
   * The authoring convention: the canonical post's share link. `publishSite`
   * resolves it to a `bskyPostRef` StrongRef at publish time. If both are set,
   * the explicit `bskyPostRef` wins.
   */
  bskyPostUri?: string;
}

/** Parse a markdown file (frontmatter + body) into a ParsedPost. */
export function parsePost(markdown: string, fallbackSlug: string): ParsedPost {
  const { data, content } = matter(markdown);
  if (!data.title) throw new Error(`post "${fallbackSlug}" is missing a title`);
  if (!data.publishedAt) throw new Error(`post "${fallbackSlug}" is missing publishedAt`);
  return {
    slug: String(data.slug ?? fallbackSlug),
    title: String(data.title),
    publishedAt: new Date(data.publishedAt).toISOString(),
    ...(data.description ? { description: String(data.description) } : {}),
    ...(Array.isArray(data.tags) ? { tags: data.tags.map(String) } : {}),
    // Presence-sensitive booleans: `share: false` must be distinguishable from
    // an absent `share`, so only set the field when the key is actually there.
    ...(data.draft !== undefined ? { draft: Boolean(data.draft) } : {}),
    ...(data.share !== undefined ? { share: Boolean(data.share) } : {}),
    body: content.trim(),
    ...(data.bskyPostRef ? { bskyPostRef: data.bskyPostRef as StrongRef } : {}),
    ...(data.bskyPostUri ? { bskyPostUri: String(data.bskyPostUri) } : {}),
  };
}

export function publicationRecord(config: PublicationConfig): PublicationRecord {
  return {
    $type: PUBLICATION_NSID,
    url: config.url.replace(/\/+$/, ""),
    name: config.name,
    ...(config.description ? { description: config.description } : {}),
  };
}

/** Very small markdown -> plaintext, so textContent stays "no markdown" per the lexicon. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "") // fenced code
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*[-*+]\s+/gm, "") // bullets
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // emphasis
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface DocumentOptions {
  /** at:// URI (or https URL) of the publication this document belongs to. */
  siteUri: string;
  updatedAt?: string;
}

export function documentRecord(post: ParsedPost, opts: DocumentOptions): DocumentRecord {
  return {
    $type: DOCUMENT_NSID,
    site: opts.siteUri,
    path: `/${post.slug}`,
    title: post.title,
    publishedAt: post.publishedAt,
    ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
    ...(post.description ? { description: post.description } : {}),
    ...(post.tags ? { tags: post.tags } : {}),
    ...(post.bskyPostRef ? { bskyPostRef: post.bskyPostRef } : {}),
    // SLIMS-64: the file-based publish path always has markdown source
    // (`post.body`), so it always emits the rich `content` member alongside
    // its plaintext mirror — every consumer still gets a renderable body via
    // textContent even if it doesn't know the content union's markdown member.
    content: { $type: MARKDOWN_CONTENT_NSID, markdown: post.body },
    textContent: toPlainText(post.body),
  };
}
