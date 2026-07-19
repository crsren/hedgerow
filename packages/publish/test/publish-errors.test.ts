// The two best-effort failure paths inside publishSite, driven with an
// in-memory Publisher so we can force the failures a real PDS won't: a share
// post that fails to mint (the document must still publish, sans anchor) and a
// pruned document that fails to delete (warn, keep pruning). The success paths
// are covered end-to-end in roundtrip.test.ts.
import { describe, expect, it } from "vitest";
import type { Publisher } from "../src/auth.js";
import { publishSite } from "../src/publish.js";
import { parsePost } from "../src/records.js";

const CFG = { url: "https://crsren.com", name: "crsren" };
const post = (slug: string) =>
  parsePost(`---\ntitle: "${slug}"\nslug: ${slug}\npublishedAt: 2026-07-19T10:00:00.000Z\n---\nBody.\n`, slug);

/** A Publisher backed by an in-memory map, with injectable failures per NSID. */
function memoryPublisher(opts: { failShare?: boolean; failDelete?: boolean } = {}): Publisher {
  const store = new Map<string, Record<string, unknown>>();
  return {
    did: "did:plc:me",
    async putRecord(collection, rkey, record) {
      if (opts.failShare && collection === "app.bsky.feed.post") throw new Error("share boom");
      store.set(`${collection}/${rkey}`, record);
      return { uri: `at://did:plc:me/${collection}/${rkey}`, cid: `cid-${rkey}` };
    },
    async getRecord(collection, rkey) {
      return store.get(`${collection}/${rkey}`) ?? null;
    },
    async deleteRecord(collection, rkey) {
      if (opts.failDelete && collection === "site.standard.document") throw new Error("delete boom");
      store.delete(`${collection}/${rkey}`);
    },
  };
}

describe("publishSite best-effort failure paths", () => {
  it("publishes the document without an anchor when the share post fails to mint", async () => {
    const pub = memoryPublisher({ failShare: true });
    const result = await publishSite(pub, CFG, [post("boom-share")], undefined, {
      share: { enabled: true },
    });

    // The document itself still went out...
    expect(result.documents.map((d) => d.slug)).toEqual(["boom-share"]);
    // ...but no share ref was recorded and the failure is surfaced, not thrown.
    expect(result.state.shares["boom-share"]).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("could not create share post"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("share boom"))).toBe(true);
  });

  it("warns but keeps pruning when a pruned document fails to delete", async () => {
    const pub = memoryPublisher({ failDelete: true });
    const first = await publishSite(pub, CFG, [post("keep"), post("orphan")]);

    const second = await publishSite(pub, CFG, [post("keep")], first.state, { prune: true });

    // The orphan is still reported pruned and dropped from state despite the
    // delete throwing — the run doesn't abort.
    expect(second.pruned).toEqual(["orphan"]);
    expect(second.state.docs.orphan).toBeUndefined();
    expect(second.state.docs.keep).toBeDefined();
    expect(second.warnings.some((w) => w.includes("could not delete pruned document"))).toBe(true);
  });
});
