// Upsert a site's records through a Publisher. Idempotent two ways: rkeys are
// persisted per slug in PublishState (so reruns target the same records), and
// unchanged records are skipped entirely (so reruns don't rewrite content or
// bump updatedAt — updatedAt only moves when a post actually changed).
import { TID } from "@atproto/common-web";
import type { Publisher } from "./auth.js";
import {
  documentRecord,
  publicationRecord,
  type ParsedPost,
  type PublicationConfig,
} from "./records.js";
import { DOCUMENT_NSID, PUBLICATION_NSID } from "./types.js";

/** slug/singleton -> record key. Persist this (e.g. .publish-state.json) between runs. */
export interface PublishState {
  publication: string | null;
  docs: Record<string, string>;
}

export const emptyState = (): PublishState => ({ publication: null, docs: {} });

export interface PublishResult {
  publicationUri: string;
  documents: { slug: string; uri: string; title: string; changed: boolean }[];
  /** Updated state — persist it so the next run reuses the same rkeys. */
  state: PublishState;
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
): Promise<PublishResult> {
  const next: PublishState = { publication: state.publication, docs: { ...state.docs } };

  const pubRkey = next.publication ?? TID.nextStr();
  const pub = await upsertIfChanged(
    publisher,
    PUBLICATION_NSID,
    pubRkey,
    publicationRecord(config) as unknown as Record<string, unknown>,
  );
  next.publication = pubRkey;

  const documents: PublishResult["documents"] = [];
  for (const post of posts) {
    const rkey = next.docs[post.slug] ?? TID.nextStr();
    const record = documentRecord(post, { siteUri: pub.uri });
    const res = await upsertIfChanged(
      publisher,
      DOCUMENT_NSID,
      rkey,
      record as unknown as Record<string, unknown>,
    );
    next.docs[post.slug] = rkey;
    documents.push({ slug: post.slug, uri: res.uri, title: post.title, changed: res.changed });
  }

  return { publicationUri: pub.uri, documents, state: next };
}
