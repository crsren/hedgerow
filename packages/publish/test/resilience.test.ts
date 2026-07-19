// Regression tests for the adversarial-review findings: publishSite must
// survive transient failures without corrupting already-published data or
// losing state that tracks real PDS side effects.
import { describe, expect, it } from "vitest";
import type { Publisher } from "../src/auth.js";
import { emptyState, publishSite } from "../src/publish.js";
import { parsePost } from "../src/records.js";
import { DOCUMENT_NSID } from "../src/types.js";

/** In-memory Publisher — lets us inject failures the in-process PDS can't. */
function memPublisher(overrides: Partial<Publisher> = {}): Publisher & {
  records: Map<string, Record<string, unknown>>;
} {
  const records = new Map<string, Record<string, unknown>>();
  return {
    records,
    did: "did:plc:test",
    async putRecord(collection, rkey, record) {
      records.set(`${collection}/${rkey}`, record);
      return { uri: `at://did:plc:test/${collection}/${rkey}`, cid: "bafyfake" };
    },
    async getRecord(collection, rkey) {
      return records.get(`${collection}/${rkey}`) ?? null;
    },
    async deleteRecord(collection, rkey) {
      records.delete(`${collection}/${rkey}`);
    },
    ...overrides,
  };
}

const post = (slug: string, extra = "") =>
  parsePost(
    `---\ntitle: "${slug}"\npublishedAt: 2026-07-19T10:00:00.000Z\n${extra}---\nBody of ${slug}.\n`,
    slug,
  );

const CONFIG = { url: "https://example.com", name: "Test" };

describe("transient anchor-resolution failure", () => {
  it("keeps the existing bskyPostRef instead of stripping it from the live record", async () => {
    const pub = memPublisher();
    const anchored = post("anchored", "bskyPostUri: at://did:plc:x/app.bsky.feed.post/3abc\n");

    // Run 1: resolution succeeds.
    const okResolve = {
      fetchImpl: (async (input: unknown) => {
        const url = String(input);
        if (url.includes("plc.directory")) {
          return new Response(
            JSON.stringify({ service: [{ id: "#atproto_pds", serviceEndpoint: "https://pds.x" }] }),
          );
        }
        return new Response(JSON.stringify({ uri: "at://did:plc:x/app.bsky.feed.post/3abc", cid: "bafyanchor", value: {} }));
      }) as typeof fetch,
    };
    const first = await publishSite(pub, CONFIG, [anchored], emptyState(), { resolveOpts: okResolve });
    const rkey = first.state.docs["anchored"]!;
    expect(pub.records.get(`${DOCUMENT_NSID}/${rkey}`)?.bskyPostRef).toMatchObject({ cid: "bafyanchor" });

    // Run 2: resolution fails transiently — the anchor must survive.
    const failResolve = {
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    };
    const second = await publishSite(pub, CONFIG, [anchored], first.state, { resolveOpts: failResolve });
    expect(second.warnings.some((w) => w.includes("kept the existing anchor"))).toBe(true);
    const record = pub.records.get(`${DOCUMENT_NSID}/${rkey}`)!;
    expect(record.bskyPostRef).toMatchObject({ cid: "bafyanchor" });
    // and nothing was rewritten: same content incl. anchor -> skip-unchanged, no updatedAt churn
    expect(record.updatedAt).toBeUndefined();
    expect(second.documents.find((d) => d.slug === "anchored")?.changed).toBe(false);
  });
});

describe("mid-run failure isolation", () => {
  it("one post's write failure becomes a warning; other posts and state survive", async () => {
    const pub = memPublisher();
    const realPut = pub.putRecord.bind(pub);
    pub.putRecord = async (collection, rkey, record) => {
      if (collection === DOCUMENT_NSID && (record.title as string).includes("bad")) {
        throw new Error("PDS hiccup");
      }
      return realPut(collection, rkey, record);
    };

    const result = await publishSite(pub, CONFIG, [post("good-1"), post("bad-2"), post("good-3")]);

    // the failing post warns, the others publish
    expect(result.warnings.some((w) => w.includes('could not publish "bad-2"'))).toBe(true);
    expect(result.documents.map((d) => d.slug)).toEqual(["good-1", "good-3"]);

    // ALL rkeys — including the failed post's — are in returned state, so a
    // rerun retries the same rkeys and can never mint duplicates.
    expect(Object.keys(result.state.docs).sort()).toEqual(["bad-2", "good-1", "good-3"]);

    // rerun with the fixed publisher heals bad-2 in place under the same rkey
    pub.putRecord = realPut;
    const second = await publishSite(pub, CONFIG, [post("good-1"), post("bad-2"), post("good-3")], result.state);
    expect(second.warnings).toEqual([]);
    expect(second.state.docs["bad-2"]).toBe(result.state.docs["bad-2"]);
    // good posts unchanged (skip-unchanged), bad-2 newly written
    expect(second.documents.find((d) => d.slug === "bad-2")?.changed).toBe(true);
    expect(second.documents.find((d) => d.slug === "good-1")?.changed).toBe(false);
  });

  it("a share minted before a failing doc write is kept in returned state (no duplicate share on rerun)", async () => {
    const pub = memPublisher();
    const realPut = pub.putRecord.bind(pub);
    let failDocWrite = true;
    pub.putRecord = async (collection, rkey, record) => {
      if (collection === DOCUMENT_NSID && failDocWrite) throw new Error("doc write failed");
      return realPut(collection, rkey, record);
    };

    const first = await publishSite(pub, CONFIG, [post("shared")], emptyState(), {
      share: { enabled: true },
    });
    // share post was created and its ref survived the doc-write failure
    expect(first.state.shares["shared"]).toBeDefined();
    const shareCount = [...pub.records.keys()].filter((k) => k.startsWith("app.bsky.feed.post/")).length;
    expect(shareCount).toBe(1);

    // rerun: no second share post minted
    failDocWrite = false;
    const second = await publishSite(pub, CONFIG, [post("shared")], first.state, {
      share: { enabled: true },
    });
    const shareCountAfter = [...pub.records.keys()].filter((k) => k.startsWith("app.bsky.feed.post/")).length;
    expect(shareCountAfter).toBe(1);
    expect(second.state.shares["shared"]).toEqual(first.state.shares["shared"]);
  });
});
