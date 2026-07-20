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

/** The public, unauthenticated Bluesky handle resolver (real network default). */
const DEFAULT_RESOLVE_HANDLE_SERVICE = "https://public.api.bsky.app";
/** The public PLC directory (real network default). */
const DEFAULT_PLC_URL = "https://plc.directory";

export interface ResolveHandleOptions {
  /**
   * Base URL to call `com.atproto.identity.resolveHandle` against. Defaults to
   * the public bsky AppView. A PDS also implements this method for the
   * accounts it hosts, so pointing this at a local PDS (e.g. `@atproto/dev-env`'s
   * `TestPds#url`) resolves local test handles fully offline.
   */
  service?: string;
}

/** Resolve a handle to its DID (real network: bsky resolver). A `did:` passes through. */
export async function resolveDid(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
  opts: ResolveHandleOptions = {},
): Promise<string> {
  if (identifier.startsWith("did:")) return identifier;
  const service = (opts.service ?? DEFAULT_RESOLVE_HANDLE_SERVICE).replace(/\/+$/, "");
  const r = await fetchImpl(
    `${service}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(identifier)}`,
  );
  if (!r.ok) throw new Error(`resolveHandle failed: ${r.status}`);
  return ((await r.json()) as { did: string }).did;
}

export interface ResolvePdsOptions extends ResolveHandleOptions {
  /**
   * PLC directory base URL. Defaults to the public `https://plc.directory`.
   * Point this at a local PLC server (e.g. `@atproto/dev-env`'s `TestPlc#url`)
   * to resolve `did:plc:` DIDs fully offline.
   */
  plcUrl?: string;
}

/** Resolve a handle/DID to its DID + PDS endpoint (real network: bsky resolver + PLC). */
export async function resolvePds(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
  opts: ResolvePdsOptions = {},
): Promise<{ did: string; pds: string }> {
  const did = await resolveDid(identifier, fetchImpl, opts);
  const plcUrl = (opts.plcUrl ?? DEFAULT_PLC_URL).replace(/\/+$/, "");
  const doc = (await (await fetchImpl(`${plcUrl}/${did}`)).json()) as {
    service?: { id: string; serviceEndpoint: string }[];
  };
  const svc = (doc.service ?? []).find((s) => s.id === "#atproto_pds");
  if (!svc) throw new Error(`no PDS endpoint in DID doc for ${did}`);
  return { did, pds: svc.serviceEndpoint };
}

export interface SiteDocument {
  /** at:// URI of the record — pages emit it in a <link rel="site.standard.document">
   * tag so the record and the live page point at each other. Null when the
   * document was shaped locally and doesn't live in a PDS (yet). */
  uri: string | null;
  value: DocumentRecord;
}

export interface Site {
  publication: PublicationRecord | null;
  /** at:// URI of the publication record (null when shaped locally). */
  publicationUri: string | null;
  documents: SiteDocument[];
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
    publicationUri: pubs[0]?.uri ?? null,
    documents: docs
      .map((r) => ({ uri: r.uri, value: r.value }))
      .sort(
        (a, b) =>
          new Date(b.value.publishedAt).getTime() - new Date(a.value.publishedAt).getTime(),
      ),
  };
}

export interface ReadSiteOptions extends ResolvePdsOptions {
  /**
   * Skip DID-document resolution (and therefore the PLC directory) entirely
   * and read straight from this PDS. The identifier is still resolved to a DID
   * (via `resolveDid`/`opts.service`) so the read targets the right repo. For
   * a local `@atproto/dev-env` network, this is the same URL as `TestPds#url`.
   */
  pds?: string;
}

/** High-level: resolve a handle/DID over the network, then read its site. */
export async function readSite(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
  opts: ReadSiteOptions = {},
): Promise<Site> {
  if (opts.pds) {
    const did = await resolveDid(identifier, fetchImpl, opts);
    return readSiteFromPds(opts.pds, did, fetchImpl);
  }
  const { did, pds } = await resolvePds(identifier, fetchImpl, opts);
  return readSiteFromPds(pds, did, fetchImpl);
}
