// Unit coverage for the network-facing read helpers (resolveDid / resolvePds /
// readSite) using an injected fetch — no live network. readSiteFromPds and
// listRecords already get exercised end-to-end by roundtrip.test.ts against a
// real in-process PDS; here we cover the identity-resolution layer above them
// and its error paths.
import { describe, expect, it } from "vitest";
import { resolveDid, resolvePds, readSite } from "../src/read.js";
import { DOCUMENT_NSID, PUBLICATION_NSID } from "../src/types.js";

/** A fetch stub that records requested URLs and dispatches on the path. */
function stub(handler: (url: URL) => { body: unknown; status?: number }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const href = input.toString();
    calls.push(href);
    const { body, status = 200 } = handler(new URL(href));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const DID = "did:plc:me";
const PDS = "https://pds.example.com";

describe("resolveDid", () => {
  it("passes a did through without any network call", async () => {
    const s = stub(() => ({ body: {} }));
    expect(await resolveDid("did:plc:already", s.fetch)).toBe("did:plc:already");
    expect(s.calls).toHaveLength(0);
  });

  it("resolves a handle to its did via the bsky resolver", async () => {
    const s = stub((url) => {
      expect(url.pathname).toContain("resolveHandle");
      expect(url.searchParams.get("handle")).toBe("chris.test");
      return { body: { did: DID } };
    });
    expect(await resolveDid("chris.test", s.fetch)).toBe(DID);
    expect(s.calls).toHaveLength(1);
  });

  it("throws when the resolver rejects the handle", async () => {
    const s = stub(() => ({ body: { error: "InvalidRequest" }, status: 400 }));
    await expect(resolveDid("nope.invalid", s.fetch)).rejects.toThrow(/resolveHandle failed: 400/);
  });
});

describe("resolvePds", () => {
  it("resolves a handle to its did + PDS endpoint from the PLC directory", async () => {
    const s = stub((url) => {
      if (url.pathname.includes("resolveHandle")) return { body: { did: DID } };
      if (url.href.includes("plc.directory")) {
        return {
          body: {
            service: [
              { id: "#other", type: "x", serviceEndpoint: "https://ignore.me" },
              { id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS },
            ],
          },
        };
      }
      throw new Error(`unexpected ${url.href}`);
    });

    expect(await resolvePds("chris.test", s.fetch)).toEqual({ did: DID, pds: PDS });
  });

  it("passes a did straight to PLC without a handle lookup", async () => {
    const s = stub((url) => {
      expect(url.href).toContain(`plc.directory/${DID}`);
      return { body: { service: [{ id: "#atproto_pds", serviceEndpoint: PDS }] } };
    });
    expect(await resolvePds(DID, s.fetch)).toEqual({ did: DID, pds: PDS });
    // only the PLC lookup, no resolveHandle round-trip
    expect(s.calls).toHaveLength(1);
  });

  it("throws when the DID document has no atproto PDS service", async () => {
    const s = stub(() => ({ body: { service: [] } }));
    await expect(resolvePds(DID, s.fetch)).rejects.toThrow(/no PDS endpoint in DID doc/);
  });
});

describe("readSite (resolve + read, end to end over injected fetch)", () => {
  const pubRecord = {
    uri: `at://${DID}/${PUBLICATION_NSID}/self`,
    cid: "bafypub",
    value: { $type: PUBLICATION_NSID, name: "crsren", url: "https://crsren.com" },
  };
  const docs = [
    {
      uri: `at://${DID}/${DOCUMENT_NSID}/older`,
      cid: "bafyold",
      value: { $type: DOCUMENT_NSID, path: "/old", title: "Old", publishedAt: "2026-01-01T00:00:00Z" },
    },
    {
      uri: `at://${DID}/${DOCUMENT_NSID}/newer`,
      cid: "bafynew",
      value: { $type: DOCUMENT_NSID, path: "/new", title: "New", publishedAt: "2026-06-01T00:00:00Z" },
    },
  ];

  function siteStub() {
    return stub((url) => {
      if (url.pathname.includes("resolveHandle")) return { body: { did: DID } };
      if (url.href.includes("plc.directory")) {
        return { body: { service: [{ id: "#atproto_pds", serviceEndpoint: PDS }] } };
      }
      if (url.pathname.endsWith("com.atproto.repo.listRecords")) {
        const collection = url.searchParams.get("collection");
        if (collection === PUBLICATION_NSID) return { body: { records: [pubRecord] } };
        if (collection === DOCUMENT_NSID) return { body: { records: docs } };
      }
      throw new Error(`unexpected ${url.href}`);
    });
  }

  it("resolves the identity then reads the publication + documents", async () => {
    const site = await readSite("chris.test", siteStub().fetch);

    expect(site.publication?.name).toBe("crsren");
    expect(site.publicationUri).toBe(pubRecord.uri);
    // documents come back newest-first regardless of listRecords order
    expect(site.documents.map((d) => d.value.path)).toEqual(["/new", "/old"]);
    expect(site.documents[0]!.uri).toBe(docs[1]!.uri);
  });

  it("reports a null publication when the repo has no publication record", async () => {
    const s = stub((url) => {
      if (url.pathname.includes("resolveHandle")) return { body: { did: DID } };
      if (url.href.includes("plc.directory")) {
        return { body: { service: [{ id: "#atproto_pds", serviceEndpoint: PDS }] } };
      }
      if (url.pathname.endsWith("com.atproto.repo.listRecords")) {
        return { body: { records: [] } };
      }
      throw new Error(`unexpected ${url.href}`);
    });
    const site = await readSite(DID, s.fetch);
    expect(site.publication).toBeNull();
    expect(site.publicationUri).toBeNull();
    expect(site.documents).toEqual([]);
  });
});
