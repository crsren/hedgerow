// The one place both render modes converge. Every page loads its data through
// loadSite(), so local and live are byte-for-byte the same downstream code path
// — the whole point of the demo is that pages render from the RECORD shape, not
// from markdown/frontmatter.
import {
  parsePost,
  publicationRecord,
  documentRecord,
  readSite,
  type Site,
  type DocumentRecord,
  type PublicationRecord,
  type PublicationConfig,
} from "@hedgerow/publish";

// Markdown is inlined by Vite at build time rather than read off disk at
// runtime. Astro 6 emits prerender chunks under `dist/.prerender/`, so a path
// derived from `import.meta.url` resolved to `dist/posts` during the build and
// the whole site failed to generate. `import.meta.glob` is resolved by the
// bundler against THIS source file's location, so dev and build agree by
// construction and there is no filesystem lookup to get wrong.
const POST_FILES = import.meta.glob<string>("../../posts/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Local publication identity. In local mode there is no PDS, so a document's
// `site` points at this plain https URL (the lexicon allows that as an alternative
// to an at:// ref).
const LOCAL_CONFIG: PublicationConfig = {
  url: "https://demo.hedgerow.local",
  name: "Hedgerow Demo",
  description:
    "A personal site rendered entirely from site.standard atproto records. No network needed — the records are shaped in memory from local markdown.",
};

/**
 * A loaded document plus its `bskyPostUri` comment anchor (SLIMS-55) — the
 * at-uri / bsky.app URL of the Bluesky post that hosts the thread. In local mode
 * it comes straight off `parsePost` (network-free — we do NOT resolve it to a
 * StrongRef at build time); in live mode it's the record's own `bskyPostRef.uri`.
 */
export interface LoadedDocument {
  uri: string | null;
  value: DocumentRecord;
  bskyPostUri?: string;
}

export interface LoadedSite {
  publication: PublicationRecord | null;
  publicationUri: string | null;
  documents: LoadedDocument[];
}

/** Shape local markdown into records in memory, then hand back a Site — the
 * comment anchor rides along as `parsePost`'s bare `bskyPostUri` (unresolved, so
 * local mode stays network-free). Local records have no at:// uri (they don't
 * live in a PDS), hence uri: null. */
function loadLocalSite(): LoadedSite {
  const publication = publicationRecord(LOCAL_CONFIG);
  const documents = Object.entries(POST_FILES)
    .map(([path, md]): LoadedDocument => {
      const slug = path.split("/").pop()!.replace(/\.md$/, "");
      const post = parsePost(md, slug);
      return {
        uri: null,
        value: documentRecord(post, { siteUri: publication.url }),
        ...(post.bskyPostUri ? { bskyPostUri: post.bskyPostUri } : {}),
      };
    })
    .sort(
      (a, b) => new Date(b.value.publishedAt).getTime() - new Date(a.value.publishedAt).getTime(),
    );
  return { publication, publicationUri: null, documents };
}

/** In live mode the anchor rides on the record itself as a `bskyPostRef` StrongRef. */
function toLoadedSite(site: Site): LoadedSite {
  return {
    publication: site.publication,
    publicationUri: site.publicationUri,
    documents: site.documents.map((doc): LoadedDocument => {
      const ref = doc.value.bskyPostRef?.uri;
      return { uri: doc.uri, value: doc.value, ...(ref ? { bskyPostUri: ref } : {}) };
    }),
  };
}

/**
 * The single entry point for both modes.
 * - live: HEDGEROW_HANDLE set -> fetch real records from the PDS.
 * - local: no env -> shape local markdown into records in memory.
 *
 * Live mode normally resolves the handle over the real network (bsky resolver
 * + plc.directory). For local end-to-end testing against an in-process
 * atproto network (`@atproto/dev-env`'s TestNetworkNoAppView — see
 * apps/demo/scripts/dev-net.mjs), three optional env vars redirect that
 * resolution:
 *   - HEDGEROW_PDS_URL: read straight from this PDS, skipping PLC entirely.
 *   - HEDGEROW_PLC_URL: use this PLC directory instead of plc.directory.
 *   - HEDGEROW_RESOLVE_HANDLE_SERVICE: resolve the handle against this
 *     service instead of the public bsky AppView. Defaults to
 *     HEDGEROW_PDS_URL when unset, since a PDS resolves handles for the
 *     accounts it hosts.
 * All three are no-ops when unset — live mode against the real network is
 * unaffected.
 */
export async function loadSite(): Promise<LoadedSite> {
  const handle = process.env.HEDGEROW_HANDLE;
  if (!handle) return loadLocalSite();

  const pds = process.env.HEDGEROW_PDS_URL;
  const plcUrl = process.env.HEDGEROW_PLC_URL;
  const service = process.env.HEDGEROW_RESOLVE_HANDLE_SERVICE ?? pds;
  const opts = {
    ...(pds ? { pds } : {}),
    ...(plcUrl ? { plcUrl } : {}),
    ...(service ? { service } : {}),
  };
  return toLoadedSite(await readSite(handle, fetch, opts));
}

// Short-TTL memo over loadSite() for per-request use. Astro runs a page's
// frontmatter on EVERY request in dev but its getStaticPaths only once per
// server run — so pages that want edits (via /edit, SLIMS-64) to show up on
// reload must re-read the site per request, and this keeps that from becoming
// one PDS round trip per page per request: within the TTL every page shares
// one in-flight/settled read (a static `astro build` renders all pages well
// inside a single window, so builds still do one fetch total).
const SITE_TTL_MS = 3_000;
let siteMemo: { at: number; promise: Promise<LoadedSite> } | null = null;
export function loadSiteFresh(): Promise<LoadedSite> {
  const now = Date.now();
  if (siteMemo && now - siteMemo.at < SITE_TTL_MS) return siteMemo.promise;
  const promise = loadSite();
  siteMemo = { at: now, promise };
  // A failed read shouldn't poison the whole TTL window — drop it so the
  // next request retries instead of re-throwing a stale error.
  promise.catch(() => {
    if (siteMemo?.promise === promise) siteMemo = null;
  });
  return promise;
}

/** The document's routable slug lives in its `path` (e.g. "/back-to-web-one"),
 * since the record shape has no slug field of its own. */
export function slugOf(doc: DocumentRecord): string {
  return (doc.path ?? "/").replace(/^\/+/, "");
}
