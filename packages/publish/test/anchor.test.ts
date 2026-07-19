// Unit coverage for the bskyPostUri -> bskyPostRef resolver. Pure normalization
// (parseBskyPostUri) plus resolveBskyPostRef against injected fake fetches, so
// no real network: we fake com.atproto.identity.resolveHandle + getRecord.
import { describe, expect, it, vi } from "vitest";
import { parseBskyPostUri, resolveBskyPostRef } from "../src/anchor.js";

const DID = "did:plc:author123";
const RKEY = "3kabc";
const CID = "bafyreiexamplecidvalue";

describe("parseBskyPostUri", () => {
  it("passes through an at:// uri with a DID authority", () => {
    expect(parseBskyPostUri(`at://${DID}/app.bsky.feed.post/${RKEY}`)).toEqual({
      authority: DID,
      rkey: RKEY,
    });
  });

  it("reads an at:// uri with a handle authority", () => {
    expect(parseBskyPostUri(`at://chris.test/app.bsky.feed.post/${RKEY}`)).toEqual({
      authority: "chris.test",
      rkey: RKEY,
    });
  });

  it("parses a bsky.app profile/post URL (handle)", () => {
    expect(parseBskyPostUri(`https://bsky.app/profile/chris.test/post/${RKEY}`)).toEqual({
      authority: "chris.test",
      rkey: RKEY,
    });
  });

  it("parses a bsky.app profile/post URL (did)", () => {
    expect(parseBskyPostUri(`https://bsky.app/profile/${DID}/post/${RKEY}`)).toEqual({
      authority: DID,
      rkey: RKEY,
    });
  });

  it("rejects an at:// uri for the wrong collection", () => {
    expect(() => parseBskyPostUri(`at://${DID}/app.bsky.feed.like/${RKEY}`)).toThrow(
      /app\.bsky\.feed\.post at-uri/,
    );
  });

  it("rejects an unrecognized url", () => {
    expect(() => parseBskyPostUri("https://example.com/whatever")).toThrow(/not a recognized/);
    expect(() => parseBskyPostUri("just a string")).toThrow(/not a valid/);
  });
});

/** A fetch fake that answers resolveHandle + getRecord and records what it saw. */
function fakeFetch(opts: {
  handleToDid?: Record<string, string>;
  cid?: string | null;
  getRecordStatus?: number;
}): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.includes("resolveHandle")) {
      const handle = new URL(url).searchParams.get("handle")!;
      const did = opts.handleToDid?.[handle];
      if (!did) return new Response("no", { status: 400 });
      return new Response(JSON.stringify({ did }), { status: 200 });
    }
    if (url.includes("getRecord")) {
      const status = opts.getRecordStatus ?? 200;
      if (status !== 200) return new Response("nope", { status });
      const rkey = new URL(url).searchParams.get("rkey")!;
      const repo = new URL(url).searchParams.get("repo")!;
      return new Response(
        JSON.stringify({ uri: `at://${repo}/app.bsky.feed.post/${rkey}`, cid: opts.cid }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

describe("resolveBskyPostRef", () => {
  it("resolves an at://did uri directly (pds override, no handle resolution)", async () => {
    const fetchImpl = fakeFetch({ cid: CID });
    const ref = await resolveBskyPostRef(`at://${DID}/app.bsky.feed.post/${RKEY}`, {
      pds: "https://pds.example",
      fetchImpl,
    });
    expect(ref).toEqual({ uri: `at://${DID}/app.bsky.feed.post/${RKEY}`, cid: CID });
  });

  it("resolves a handle at-uri to the canonical DID at-uri", async () => {
    const fetchImpl = fakeFetch({ handleToDid: { "chris.test": DID }, cid: CID });
    const ref = await resolveBskyPostRef(`at://chris.test/app.bsky.feed.post/${RKEY}`, {
      pds: "https://pds.example",
      fetchImpl,
    });
    // uri is rewritten to use the DID, not the handle
    expect(ref.uri).toBe(`at://${DID}/app.bsky.feed.post/${RKEY}`);
    expect(ref.cid).toBe(CID);
  });

  it("resolves a bsky.app URL", async () => {
    const fetchImpl = fakeFetch({ handleToDid: { "chris.test": DID }, cid: CID });
    const ref = await resolveBskyPostRef(`https://bsky.app/profile/chris.test/post/${RKEY}`, {
      pds: "https://pds.example",
      fetchImpl,
    });
    expect(ref).toEqual({ uri: `at://${DID}/app.bsky.feed.post/${RKEY}`, cid: CID });
  });

  it("throws a clear error when the post is gone (getRecord 400)", async () => {
    const fetchImpl = fakeFetch({ cid: null, getRecordStatus: 400 });
    await expect(
      resolveBskyPostRef(`at://${DID}/app.bsky.feed.post/${RKEY}`, {
        pds: "https://pds.example",
        fetchImpl,
      }),
    ).rejects.toThrow(/not found.*deleted/);
  });
});
