// Upsert a site's records through a Publisher. Idempotent two ways: rkeys are
// persisted per slug in PublishState (so reruns target the same records), and
// unchanged records are skipped entirely (so reruns don't rewrite content or
// bump updatedAt — updatedAt only moves when a post actually changed).
import { TID } from "@atproto/common-web";
import { resolveBskyPostRef, type ResolveBskyPostRefOptions } from "./anchor.js";
import type { Publisher } from "./auth.js";
import {
  documentRecord,
  publicationRecord,
  type ParsedPost,
  type PublicationConfig,
} from "./records.js";
import { BSKY_POST_NSID, DOCUMENT_NSID, PUBLICATION_NSID, type StrongRef } from "./types.js";

/** slug/singleton -> record key. Persist this (e.g. .publish-state.json) between runs. */
export interface PublishState {
  publication: string | null;
  docs: Record<string, string>;
  /**
   * slug -> StrongRef of the canonical Bluesky share post auto-created for that
   * document (SLIMS-62). Reused across runs so a post never gets a duplicate
   * share. Backward-compatible: absent in older state files, defaulted to {}.
   */
  shares: Record<string, StrongRef>;
}

export const emptyState = (): PublishState => ({ publication: null, docs: {}, shares: {} });

/** Shallow-clone state for mutation; `shares` defaults so pre-shares state files load cleanly. */
const cloneState = (state: PublishState): PublishState => ({
  publication: state.publication,
  docs: { ...state.docs },
  shares: { ...(state.shares ?? {}) },
});

export interface PublishResult {
  publicationUri: string;
  documents: { slug: string; uri: string; title: string; changed: boolean }[];
  /** Updated state — persist it so the next run reuses the same rkeys. */
  state: PublishState;
  /**
   * Non-fatal problems that didn't abort the run — a post whose `bskyPostUri`
   * couldn't be resolved, a share post that failed to create, or a pruned
   * document that couldn't be deleted (the run still succeeds, minus that one
   * effect). Empty on a clean run.
   */
  warnings: string[];
  /** Slugs whose document records were deleted this run by prune. Empty when prune is off. */
  pruned: string[];
  /**
   * Slugs skipped this run because the post is a draft (`draft: true`). A skipped
   * draft is never written and never shared, but its slug is NOT pruned — a post
   * flipped to draft keeps its already-published record until it's explicitly
   * unpublished (delete the file + prune). Empty when no drafts were present.
   */
  skipped: string[];
}

/** Auto-create a canonical Bluesky share post for documents lacking a comment anchor. */
export interface ShareOptions {
  enabled: true;
  /**
   * Override the share post text. Receives the parsed post and the canonical
   * article URL. Default: `${post.title}\n\n${canonicalUrl}`.
   */
  text?: (post: ParsedPost, url: string) => string;
}

export interface PublishOptions {
  /** Passthrough for the bskyPostUri -> bskyPostRef resolver (pds override / fetch). */
  resolveOpts?: ResolveBskyPostRefOptions;
  /**
   * When enabled, mint a canonical `app.bsky.feed.post` for any document that
   * has no explicit anchor (no bskyPostRef, no bskyPostUri) and no persisted
   * share, then use that post as the document's `bskyPostRef` (SLIMS-62).
   */
  share?: ShareOptions;
  /**
   * When true, after publishing, delete document records for slugs in state
   * that are no longer among the provided posts. Off by default. Never touches
   * the publication record or the pruned docs' Bluesky share posts.
   */
  prune?: boolean;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Compare records ignoring updatedAt — the field we stamp, not author. */
function sameContent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const { updatedAt: _a, ...restA } = a;
  const { updatedAt: _b, ...restB } = b;
  return deepEqual(restA, restB);
}

async function upsertIfChanged(
  publisher: Publisher,
  collection: string,
  rkey: string,
  record: Record<string, unknown>,
): Promise<{ uri: string; changed: boolean }> {
  const existing = await publisher.getRecord(collection, rkey);
  if (existing && sameContent(existing, record)) {
    return { uri: `at://${publisher.did}/${collection}/${rkey}`, changed: false };
  }
  const toWrite = existing ? { ...record, updatedAt: new Date().toISOString() } : record;
  const res = await publisher.putRecord(collection, rkey, toWrite);
  return { uri: res.uri, changed: true };
}

export async function publishSite(
  publisher: Publisher,
  config: PublicationConfig,
  posts: ParsedPost[],
  state: PublishState = emptyState(),
  options: PublishOptions = {},
): Promise<PublishResult> {
  const next = cloneState(state);
  const warnings: string[] = [];

  // Canonical site origin (trailing slash stripped, same as the publication record):
  // origin + `/${slug}` is the article URL a share post links to.
  const siteOrigin = config.url.replace(/\/+$/, "");

  const pubRkey = next.publication ?? TID.nextStr();
  const pub = await upsertIfChanged(
    publisher,
    PUBLICATION_NSID,
    pubRkey,
    publicationRecord(config) as unknown as Record<string, unknown>,
  );
  next.publication = pubRkey;

  const documents: PublishResult["documents"] = [];
  const skipped: string[] = [];
  for (const post of posts) {
    // Drafts are skipped whole: no record write, no share. We deliberately do
    // NOT touch next.docs[slug] — a previously-published post flipped to draft
    // keeps its live record (and, being in `posts`, its slug stays in the prune
    // keep-set below), so going draft never silently deletes what's published.
    if (post.draft) {
      skipped.push(post.slug);
      continue;
    }

    const rkey = next.docs[post.slug] ?? TID.nextStr();

    // An explicit bskyPostRef always wins; otherwise resolve the interim
    // bskyPostUri to a StrongRef. Resolution failure is non-fatal: the post is
    // published without an anchor and the reason is surfaced as a warning, so
    // one dead post link can't sink the whole publish.
    let bskyPostRef = post.bskyPostRef;
    if (!bskyPostRef && post.bskyPostUri) {
      try {
        bskyPostRef = await resolveBskyPostRef(post.bskyPostUri, options.resolveOpts);
      } catch (err) {
        warnings.push(
          `could not resolve bskyPostRef for "${post.slug}" (${post.bskyPostUri}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Auto-share: only for posts with no explicit anchor of any kind. An
    // explicit bskyPostRef/bskyPostUri always wins over a persisted share, so
    // a post that later gains one silently drops its auto-share (the old share
    // post still exists on Bluesky; state just stops pointing at it here).
    if (!bskyPostRef && !post.bskyPostUri) {
      const persisted = next.shares[post.slug];
      if (persisted) {
        // Reuse the share created on a prior run — never mint a duplicate. This
        // holds even when share isn't enabled this run, so the document keeps
        // its anchor instead of flapping. `share: false` only blocks minting a
        // NEW share, not reusing one already created for this slug.
        bskyPostRef = persisted;
      } else if (options.share?.enabled && post.share !== false) {
        const canonicalUrl = `${siteOrigin}/${post.slug}`;
        try {
          bskyPostRef = await createSharePost(publisher, post, canonicalUrl, options.share);
          next.shares[post.slug] = bskyPostRef;
        } catch (err) {
          // Share creation is best-effort: publish the document without the
          // anchor and surface the reason rather than sinking the whole run.
          warnings.push(
            `could not create share post for "${post.slug}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    const record = documentRecord({ ...post, bskyPostRef }, { siteUri: pub.uri });
    const res = await upsertIfChanged(
      publisher,
      DOCUMENT_NSID,
      rkey,
      record as unknown as Record<string, unknown>,
    );
    next.docs[post.slug] = rkey;
    documents.push({ slug: post.slug, uri: res.uri, title: post.title, changed: res.changed });
  }

  const pruned: string[] = [];
  if (options.prune) {
    // Every provided post's slug is kept — INCLUDING drafts, which we skipped
    // above. A draft is still "present" as far as prune is concerned, so its
    // published record survives; only removing the file (so the slug leaves
    // `posts`) makes prune delete it.
    const keep = new Set(posts.map((p) => p.slug));
    // Union of docs + shares: a slug tracked in either but no longer published
    // is an orphan. We delete its document record (if any) and stop tracking it
    // in docs, but deliberately KEEP its share ref — the Bluesky conversation
    // may still have value, so v1 never deletes a pruned doc's share post.
    const known = new Set([...Object.keys(next.docs), ...Object.keys(next.shares)]);
    for (const slug of known) {
      if (keep.has(slug)) continue;
      const rkey = next.docs[slug];
      if (rkey) {
        try {
          await publisher.deleteRecord(DOCUMENT_NSID, rkey);
        } catch (err) {
          // Already-gone records are fine; warn rather than abort the run.
          warnings.push(
            `could not delete pruned document "${slug}" (${rkey}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        delete next.docs[slug];
        // Only slugs that actually had a document this run are reported: a
        // kept share ref would otherwise re-report its slug on every prune.
        pruned.push(slug);
      }
    }
  }

  return { publicationUri: pub.uri, documents, state: next, warnings, pruned, skipped };
}

/**
 * Mint the canonical Bluesky share post for a document: an `app.bsky.feed.post`
 * with an external embed pointing at the article URL. Returns its StrongRef,
 * which becomes the document's `bskyPostRef` in the same run. No thumb blob in v1.
 */
async function createSharePost(
  publisher: Publisher,
  post: ParsedPost,
  canonicalUrl: string,
  share: ShareOptions,
): Promise<StrongRef> {
  const text = share.text?.(post, canonicalUrl) ?? `${post.title}\n\n${canonicalUrl}`;
  const record = {
    $type: BSKY_POST_NSID,
    text,
    createdAt: new Date().toISOString(),
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: canonicalUrl,
        title: post.title,
        description: post.description ?? "",
      },
    },
  };
  const rkey = TID.nextStr();
  const res = await publisher.putRecord(BSKY_POST_NSID, rkey, record);
  return { uri: res.uri, cid: res.cid };
}

/** Outcome of {@link unshare}. Persist `state`; `warnings` surfaces the soft cases. */
export interface UnshareResult {
  /** Updated state — the share entry for the slug is gone. Persist it. */
  state: PublishState;
  /** True iff a share post record was actually deleted this call. */
  removed: boolean;
  /**
   * Non-fatal notes: the slug was never shared, the share post was already gone,
   * or the document couldn't be rewritten. The state edit still applies.
   */
  warnings: string[];
}

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Undo an auto-share: delete the canonical Bluesky share post for `slug`, drop
 * its entry from `state.shares`, and — if the document record still anchors to
 * that share — rewrite the document without its `bskyPostRef`.
 *
 * DESTRUCTIVE AND IRREVERSIBLE: deleting the `app.bsky.feed.post` deletes the
 * reply thread hanging off it. Every comment on that share is gone for good;
 * re-sharing later mints a fresh post with an empty thread, not the old one.
 *
 * Non-fatal by design (matches publishSite): a slug that was never shared, or a
 * share post that's already gone, returns a warning rather than throwing — only
 * a structurally broken stored uri (no parseable rkey) throws. The state edit
 * (removing `shares[slug]`) always applies, so calling twice is safe.
 */
export async function unshare(
  publisher: Publisher,
  slug: string,
  state: PublishState,
): Promise<UnshareResult> {
  const next = cloneState(state);
  const warnings: string[] = [];

  const shareRef = next.shares[slug];
  if (!shareRef) {
    return { state: next, removed: false, warnings: [`no share post tracked for "${slug}"`] };
  }

  const shareRkey = shareRef.uri.split("/").pop();
  if (!shareRkey) {
    // Clearly-broken input: a stored uri we can't derive an rkey from.
    throw new Error(`unshare: malformed share uri for "${slug}": ${shareRef.uri}`);
  }

  let removed = false;
  try {
    await publisher.deleteRecord(BSKY_POST_NSID, shareRkey);
    removed = true;
  } catch (err) {
    warnings.push(
      `share post for "${slug}" (${shareRkey}) could not be deleted (already gone?): ${errMessage(err)}`,
    );
  }

  // Strip the anchor from the document, but only if it still points at THIS
  // share — never clobber an anchor the author has since repointed elsewhere.
  const docRkey = next.docs[slug];
  if (docRkey) {
    try {
      const existing = await publisher.getRecord(DOCUMENT_NSID, docRkey);
      const currentRef = (existing as { bskyPostRef?: StrongRef } | null)?.bskyPostRef;
      if (existing && currentRef?.uri === shareRef.uri) {
        const { bskyPostRef: _drop, ...rest } = existing;
        await publisher.putRecord(DOCUMENT_NSID, docRkey, {
          ...rest,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      warnings.push(
        `could not rewrite document "${slug}" (${docRkey}) without its anchor: ${errMessage(err)}`,
      );
    }
  } else {
    warnings.push(`no document tracked for "${slug}"; removed the share ref from state only`);
  }

  delete next.shares[slug];
  return { state: next, removed, warnings };
}
