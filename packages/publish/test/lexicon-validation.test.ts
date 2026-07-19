// Lexicon-drift guard: validate the records our hand-written shaping functions
// produce against the authoritative lexicon JSON vendored under ./lexicons.
// src/types.ts + src/records.ts hand-write narrow shapes; nothing else links
// them to the schemas. This test is that link — if a shaped record stops
// matching the vendored lexicon, it fails here instead of silently drifting.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Lexicons } from "@atproto/lexicon";
import type { LexiconDoc } from "@atproto/lexicon";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DOCUMENT_NSID,
  PUBLICATION_NSID,
  documentRecord,
  parsePost,
  publicationRecord,
} from "../src/index.js";

const LEXICONS_DIR = fileURLToPath(new URL("../lexicons", import.meta.url));

/** Recursively collect every *.json path under a directory. */
function findJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonFiles(full));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function loadLexiconDocs(): LexiconDoc[] {
  return findJsonFiles(LEXICONS_DIR).map(
    (path) => JSON.parse(readFileSync(path, "utf8")) as LexiconDoc,
  );
}

describe("vendored lexicon documents", () => {
  it("are all valid lexicon docs and construct a Lexicons collection", () => {
    const docs = loadLexiconDocs();
    expect(docs.length).toBeGreaterThan(0);
    // Constructing with an iterable runs each doc through the lexiconDoc schema
    // (via .add); a malformed vendored doc throws here.
    expect(() => new Lexicons(docs)).not.toThrow();
  });

  it("include the two NSIDs we publish", () => {
    const lexicons = new Lexicons(loadLexiconDocs());
    expect(lexicons.get(PUBLICATION_NSID)).toBeDefined();
    expect(lexicons.get(DOCUMENT_NSID)).toBeDefined();
  });
});

describe("records validate against the vendored lexicons", () => {
  let lexicons: Lexicons;
  beforeAll(() => {
    lexicons = new Lexicons(loadLexiconDocs());
  });

  it("publicationRecord passes site.standard.publication", () => {
    const record = publicationRecord({
      url: "https://crsren.com/",
      name: "crsren",
      description: "A personal site published to the AT protocol.",
    });
    // Also proves the trailing slash was stripped to satisfy format: uri.
    expect(record.url).toBe("https://crsren.com");
    expect(() =>
      lexicons.assertValidRecord(PUBLICATION_NSID, record),
    ).not.toThrow();
  });

  it("documentRecord (full-featured) passes site.standard.document", () => {
    const post = parsePost(
      `---
title: "Owning My Words"
slug: owning-my-words
publishedAt: 2026-07-19T10:00:00.000Z
description: "Why I publish to my own PDS."
tags: [atproto, indieweb, publishing]
---
The web used to be a place you owned.

Here is some **markdown** with a [link](https://example.com) and \`code\`.
`,
      "owning-my-words",
    );
    const record = documentRecord(post, {
      siteUri:
        "at://did:plc:abc123/site.standard.publication/3jt5vlkbqm225",
      updatedAt: "2026-07-19T12:00:00.000Z",
    });
    expect(() =>
      lexicons.assertValidRecord(DOCUMENT_NSID, record),
    ).not.toThrow();
  });

  it("documentRecord with a bskyPostRef strongRef passes site.standard.document", () => {
    const post = parsePost(
      `---
title: "Comments Live on Bluesky"
slug: comments-on-bluesky
publishedAt: 2026-07-19T10:00:00.000Z
bskyPostRef:
  uri: at://did:plc:abc123/app.bsky.feed.post/3jt5vlkbqm225
  cid: bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a
---
Talk about this post on Bluesky.
`,
      "comments-on-bluesky",
    );
    const record = documentRecord(post, {
      siteUri:
        "at://did:plc:abc123/site.standard.publication/3jt5vlkbqm225",
    });
    expect(record.bskyPostRef).toEqual({
      uri: "at://did:plc:abc123/app.bsky.feed.post/3jt5vlkbqm225",
      cid: "bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a",
    });
    expect(() =>
      lexicons.assertValidRecord(DOCUMENT_NSID, record),
    ).not.toThrow();
  });

  it("also validates a loose document referencing a plain https:// site url", () => {
    const post = parsePost(
      `---
title: "A Loose Document"
slug: loose
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "loose",
    );
    const record = documentRecord(post, { siteUri: "https://crsren.com" });
    expect(() =>
      lexicons.assertValidRecord(DOCUMENT_NSID, record),
    ).not.toThrow();
  });
});

describe("negative controls: the guard actually bites", () => {
  let lexicons: Lexicons;
  beforeAll(() => {
    lexicons = new Lexicons(loadLexiconDocs());
  });

  it("rejects a publication missing the required name", () => {
    const invalid = {
      $type: PUBLICATION_NSID,
      url: "https://crsren.com",
      // name intentionally omitted (required by the lexicon)
    };
    expect(() =>
      lexicons.assertValidRecord(PUBLICATION_NSID, invalid),
    ).toThrow();
  });

  it("rejects a document whose title is a number instead of a string", () => {
    const invalid = {
      $type: DOCUMENT_NSID,
      site: "https://crsren.com",
      title: 42,
      publishedAt: "2026-07-19T10:00:00.000Z",
    };
    expect(() =>
      lexicons.assertValidRecord(DOCUMENT_NSID, invalid),
    ).toThrow();
  });
});
