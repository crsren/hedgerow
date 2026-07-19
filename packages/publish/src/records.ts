// Pure transforms: markdown post -> standard.site records. No I/O, fully unit-testable.
import matter from "gray-matter";
import {
  DOCUMENT_NSID,
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
    textContent: toPlainText(post.body),
  };
}
