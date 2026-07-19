// Read records back FROM a PDS (public, unauthenticated). Proves the site is
// driven by the atproto records, not local files. The AppView (api.bsky.app)
// does NOT serve custom collections, so we always hit the repo's own PDS.
import {
  DOCUMENT_NSID,
  PUBLICATION_NSID,
  type DocumentRecord,
  type PublicationRecord,
} from "./types.js";

export interface RepoRecord<T> {
  uri: string;
  cid: string;
  value: T;
}

/** Low-level: unauthenticated listRecords against a known PDS, paging the cursor. */
export async function listRecords<T>(
  pds: string,
  repo: string,
  collection: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoRecord<T>[]> {
  const out: RepoRecord<T>[] = [];
  let cursor: string | undefined;
  do {
    const u = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    u.searchParams.set("repo", repo);
    u.searchParams.set("collection", collection);
    u.searchParams.set("limit", "100");
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetchImpl(u);
    if (!res.ok) throw new Error(`listRecords ${collection}: ${res.status}`);
    const data = (await res.json()) as { records: RepoRecord<T>[]; cursor?: string };
    out.push(...data.records);
    cursor = data.cursor;
  } while (cursor);
  return out;
}

/** Resolve a handle/DID to its DID + PDS endpoint (real network: bsky resolver + PLC). */
export async function resolvePds(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ did: string; pds: string }> {
  let did = identifier;
  if (!identifier.startsWith("did:")) {
    const r = await fetchImpl(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(identifier)}`,
    );
    if (!r.ok) throw new Error(`resolveHandle failed: ${r.status}`);
    did = ((await r.json()) as { did: string }).did;
  }
  const doc = (await (await fetchImpl(`https://plc.directory/${did}`)).json()) as {
    service?: { id: string; serviceEndpoint: string }[];
  };
  const svc = (doc.service ?? []).find((s) => s.id === "#atproto_pds");
  if (!svc) throw new Error(`no PDS endpoint in DID doc for ${did}`);
  return { did, pds: svc.serviceEndpoint };
}

export interface Site {
  publication: PublicationRecord | null;
  documents: DocumentRecord[];
}

/** Read a full site (publication + documents) directly from a PDS by repo DID. */
export async function readSiteFromPds(
  pds: string,
  did: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Site> {
  const [pubs, docs] = await Promise.all([
    listRecords<PublicationRecord>(pds, did, PUBLICATION_NSID, fetchImpl),
    listRecords<DocumentRecord>(pds, did, DOCUMENT_NSID, fetchImpl),
  ]);
  return {
    publication: pubs[0]?.value ?? null,
    documents: docs
      .map((r) => r.value)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
  };
}

/** High-level: resolve a handle/DID over the network, then read its site. */
export async function readSite(identifier: string, fetchImpl: typeof fetch = fetch): Promise<Site> {
  const { did, pds } = await resolvePds(identifier, fetchImpl);
  return readSiteFromPds(pds, did, fetchImpl);
}
