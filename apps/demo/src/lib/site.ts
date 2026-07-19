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

/** Shape local markdown into records in memory, then hand back a Site — never
 * touching the raw frontmatter downstream. Local records have no at:// uri
 * (they don't live in a PDS), hence uri: null. */
function loadLocalSite(): Site {
  const publication = publicationRecord(LOCAL_CONFIG);
  const documents = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const md = readFileSync(join(POSTS_DIR, file), "utf8");
      const post = parsePost(md, file.replace(/\.md$/, ""));
      return { uri: null, value: documentRecord(post, { siteUri: publication.url }) };
    })
    .sort(
      (a, b) => new Date(b.value.publishedAt).getTime() - new Date(a.value.publishedAt).getTime(),
    );
  return { publication, publicationUri: null, documents };
}

/**
 * The single entry point for both modes.
 * - live: HEDGEROW_HANDLE set -> fetch real records from the PDS.
 * - local: no env -> shape local markdown into records in memory.
 */
export async function loadSite(): Promise<Site> {
  const handle = process.env.HEDGEROW_HANDLE;
  if (handle) return readSite(handle);
  return loadLocalSite();
}

/** The document's routable slug lives in its `path` (e.g. "/back-to-web-one"),
 * since the record shape has no slug field of its own. */
export function slugOf(doc: DocumentRecord): string {
  return (doc.path ?? "/").replace(/^\/+/, "");
}
