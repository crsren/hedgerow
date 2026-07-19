// The one place both render modes converge. Every page loads its data through
// loadSite(), so local and live are byte-for-byte the same downstream code path
// — the whole point of the demo is that pages render from the RECORD shape, not
// from markdown/frontmatter.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
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

const POSTS_DIR = fileURLToPath(new URL("../../posts", import.meta.url));

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
 * A loaded document plus the interim `bskyPostUri` comment anchor (SLIMS-55).
 *
 * `bskyPostUri` is read straight from frontmatter here, NOT via the publish
 * package: `parsePost` only recognises a full `bskyPostRef` StrongRef (uri+cid),
 * whereas the interim demo convention is a bare at-uri / bsky.app URL string.
 * Rather than touch `@hedgerow/publish`, the demo reads that one field itself.
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

/** Pull `bskyPostUri` out of a markdown file's YAML frontmatter block. */
function readBskyPostUri(markdown: string): string | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  if (!frontmatter) return undefined;
  const match = /^\s*bskyPostUri:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(frontmatter);
  return match?.[1]?.trim();
}

/** Shape local markdown into records in memory, then hand back a Site — never
 * touching the raw frontmatter downstream except for the interim comment anchor.
 * Local records have no at:// uri (they don't live in a PDS), hence uri: null. */
function loadLocalSite(): LoadedSite {
  const publication = publicationRecord(LOCAL_CONFIG);
  const documents = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file): LoadedDocument => {
      const md = readFileSync(join(POSTS_DIR, file), "utf8");
      const post = parsePost(md, file.replace(/\.md$/, ""));
      const bskyPostUri = readBskyPostUri(md);
      return {
        uri: null,
        value: documentRecord(post, { siteUri: publication.url }),
        ...(bskyPostUri ? { bskyPostUri } : {}),
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
 */
export async function loadSite(): Promise<LoadedSite> {
  const handle = process.env.HEDGEROW_HANDLE;
  if (handle) return toLoadedSite(await readSite(handle));
  return loadLocalSite();
}

/** The document's routable slug lives in its `path` (e.g. "/back-to-web-one"),
 * since the record shape has no slug field of its own. */
export function slugOf(doc: DocumentRecord): string {
  return (doc.path ?? "/").replace(/^\/+/, "");
}
