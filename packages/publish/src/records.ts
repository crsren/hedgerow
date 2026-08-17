// Pure transforms: markdown post -> standard.site records. No I/O, fully unit-testable.
import matter from "gray-matter";
import type { StrongRef } from "./types.js";
import { normalizeDocumentPath } from "./document-records.js";

export {
  documentRecord,
  markdownDocumentRecord,
  normalizeDocumentPath,
  publicationRecord,
  toPlainText,
} from "./document-records.js";
export type {
  DocumentOptions,
  MarkdownDocumentInput,
} from "./document-records.js";

export interface PublicationConfig {
  /** Canonical site URL. A trailing slash is stripped to satisfy the lexicon. */
  url: string;
  name: string;
  description?: string;
}

export interface ParsedPost {
  slug: string;
  /** Canonical path. Defaults to `/${slug}`. */
  path?: string;
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
    ...(data.path ? { path: normalizeDocumentPath(String(data.path)) } : {}),
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
