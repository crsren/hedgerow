// Browser-safe transforms for shaping standard.site records. This module is
// intentionally separate from records.ts, whose compatibility surface also
// contains the Node-oriented gray-matter parser.
import {
  DOCUMENT_NSID,
  MARKDOWN_CONTENT_NSID,
  PUBLICATION_NSID,
  VIA_KEY,
  VIA_VALUE,
  type DocumentRecord,
  type PublicationRecord,
  type StrongRef,
} from "./types.js";
import type { ParsedPost, PublicationConfig } from "./records.js";

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

/** Ensure standard.site document paths are origin-relative and canonical. */
export function normalizeDocumentPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("document path must not be empty");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Framework-neutral input for a Markdown-backed standard.site document. */
export interface MarkdownDocumentInput {
  /** at:// URI (or https URL) of the publication this document belongs to. */
  site: string;
  title: string;
  /** ISO datetime. */
  publishedAt: string;
  path?: string;
  description?: string;
  tags?: string[];
  markdown: string;
  bskyPostRef?: StrongRef;
  updatedAt?: string;
}

/** Build the complete record written by browser and filesystem authoring paths. */
export function markdownDocumentRecord(input: MarkdownDocumentInput): DocumentRecord {
  return {
    $type: DOCUMENT_NSID,
    site: input.site,
    title: input.title,
    publishedAt: new Date(input.publishedAt).toISOString(),
    ...(input.path ? { path: normalizeDocumentPath(input.path) } : {}),
    ...(input.updatedAt
      ? { updatedAt: new Date(input.updatedAt).toISOString() }
      : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.bskyPostRef ? { bskyPostRef: input.bskyPostRef } : {}),
    content: { $type: MARKDOWN_CONTENT_NSID, markdown: input.markdown },
    textContent: toPlainText(input.markdown),
    [VIA_KEY]: VIA_VALUE,
  };
}

export interface DocumentOptions {
  /** at:// URI (or https URL) of the publication this document belongs to. */
  siteUri: string;
  updatedAt?: string;
}

export function documentRecord(post: ParsedPost, opts: DocumentOptions): DocumentRecord {
  return markdownDocumentRecord({
    site: opts.siteUri,
    path: post.path ?? `/${post.slug}`,
    title: post.title,
    publishedAt: post.publishedAt,
    markdown: post.body,
    ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
    ...(post.description ? { description: post.description } : {}),
    ...(post.tags ? { tags: post.tags } : {}),
    ...(post.bskyPostRef ? { bskyPostRef: post.bskyPostRef } : {}),
  });
}
