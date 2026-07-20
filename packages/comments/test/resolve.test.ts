import { beforeEach, describe, expect, it } from "vitest";
import {
  atUriToBskyUrl,
  clearHandleCache,
  resolveHandle,
  resolvePostUri,
} from "../src/resolve.js";
import { HedgerowFetchError } from "../src/errors.js";
import { loadFixture, jsonResponse, stubFetch } from "./helpers.js";

const DID = "did:plc:z72i7hdynmk6r22z27h6tvur";
const RKEY = "3abcd";
const AT_DID = `at://${DID}/app.bsky.feed.post/${RKEY}`;

function resolveStub() {
  const { did } = loadFixture<{ did: string }>("resolveHandle");
  return stubFetch((url) => {
    if (url.pathname.endsWith("com.atproto.identity.resolveHandle")) {
      return jsonResponse({ did });
    }
    return jsonResponse({ error: "MethodNotImplemented" }, 501);
  });
}

describe("resolvePostUri", () => {
  beforeEach(() => clearHandleCache());

  it("passes through an at:// URI that already has a DID (no network)", async () => {
    const stub = resolveStub();
    const uri = await resolvePostUri(AT_DID, { fetchImpl: stub.fetch });
    expect(uri).toBe(AT_DID);
    expect(stub.calls).toHaveLength(0);
  });

  it("resolves an at:// URI that uses a handle", async () => {
    const stub = resolveStub();
    const uri = await resolvePostUri(`at://bsky.app/app.bsky.feed.post/${RKEY}`, {
      fetchImpl: stub.fetch,
    });
    expect(uri).toBe(AT_DID);
    expect(stub.calls).toHaveLength(1);
  });

  it("resolves a bsky.app profile URL with a handle", async () => {
    const stub = resolveStub();
    const uri = await resolvePostUri(`https://bsky.app/profile/bsky.app/post/${RKEY}`, {
      fetchImpl: stub.fetch,
    });
    expect(uri).toBe(AT_DID);
    expect(stub.calls).toHaveLength(1);
  });

  it("handles a bsky.app profile URL that already uses a DID (no network)", async () => {
    const stub = resolveStub();
    const uri = await resolvePostUri(`https://bsky.app/profile/${DID}/post/${RKEY}`, {
      fetchImpl: stub.fetch,
    });
    expect(uri).toBe(AT_DID);
    expect(stub.calls).toHaveLength(0);
  });

  it("throws a typed error on an unrecognized reference", async () => {
    await expect(resolvePostUri("not a post ref")).rejects.toBeInstanceOf(HedgerowFetchError);
  });
});

describe("resolveHandle caching", () => {
  beforeEach(() => clearHandleCache());

  it("memoizes a handle→DID resolution within the TTL", async () => {
    const stub = resolveStub();
    const a = await resolveHandle("bsky.app", { fetchImpl: stub.fetch });
    const b = await resolveHandle("BSKY.APP", { fetchImpl: stub.fetch }); // case-insensitive
    expect(a).toBe(DID);
    expect(b).toBe(DID);
    expect(stub.calls).toHaveLength(1);
  });

  it("does not cache when cacheTtlMs is 0", async () => {
    const stub = resolveStub();
    await resolveHandle("bsky.app", { fetchImpl: stub.fetch, cacheTtlMs: 0 });
    await resolveHandle("bsky.app", { fetchImpl: stub.fetch, cacheTtlMs: 0 });
    expect(stub.calls).toHaveLength(2);
  });

  it("dedupes a concurrent burst for the same handle into one fetch", async () => {
    const stub = resolveStub();
    const results = await Promise.all([
      resolveHandle("bsky.app", { fetchImpl: stub.fetch }),
      resolveHandle("bsky.app", { fetchImpl: stub.fetch }),
      resolveHandle("BSKY.APP", { fetchImpl: stub.fetch }), // case-insensitive, same in-flight entry
    ]);
    expect(results).toEqual([DID, DID, DID]);
    expect(stub.calls).toHaveLength(1);
  });

  it("still dedupes a concurrent burst when cacheTtlMs is 0 (in-flight sharing is independent of the settled cache)", async () => {
    const stub = resolveStub();
    const results = await Promise.all([
      resolveHandle("bsky.app", { fetchImpl: stub.fetch, cacheTtlMs: 0 }),
      resolveHandle("bsky.app", { fetchImpl: stub.fetch, cacheTtlMs: 0 }),
    ]);
    expect(results).toEqual([DID, DID]);
    expect(stub.calls).toHaveLength(1); // shared in-flight promise, even though nothing gets cached after

    // But once settled, cacheTtlMs: 0 means the NEXT call re-fetches rather
    // than reusing a settled cache entry.
    await resolveHandle("bsky.app", { fetchImpl: stub.fetch, cacheTtlMs: 0 });
    expect(stub.calls).toHaveLength(2);
  });

  it("does not cache a rejection — a later call retries the fetch", async () => {
    let calls = 0;
    const stub = stubFetch(() => {
      calls++;
      throw new Error("network down");
    });

    await expect(resolveHandle("bsky.app", { fetchImpl: stub.fetch })).rejects.toBeInstanceOf(
      HedgerowFetchError,
    );
    expect(calls).toBe(1);

    // Retried after the rejection — not stuck behind a dead in-flight entry,
    // and not treated as a cached failure.
    const resolveOk = resolveStub();
    const did = await resolveHandle("bsky.app", { fetchImpl: resolveOk.fetch });
    expect(did).toBe(DID);
    expect(resolveOk.calls).toHaveLength(1);
  });

  it("a burst racing a rejection all reject, and a subsequent call still retries", async () => {
    let calls = 0;
    const stub = stubFetch(() => {
      calls++;
      throw new Error("network down");
    });

    const results = await Promise.allSettled([
      resolveHandle("bsky.app", { fetchImpl: stub.fetch }),
      resolveHandle("bsky.app", { fetchImpl: stub.fetch }),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(calls).toBe(1); // the burst still shared ONE in-flight request, which then rejected for everyone

    const resolveOk = resolveStub();
    expect(await resolveHandle("bsky.app", { fetchImpl: resolveOk.fetch })).toBe(DID);
    expect(resolveOk.calls).toHaveLength(1);
  });
});

describe("atUriToBskyUrl", () => {
  it("builds the web URL from an at:// post URI", () => {
    expect(atUriToBskyUrl(AT_DID)).toBe(`https://bsky.app/profile/${DID}/post/${RKEY}`);
  });

  it("throws on a non-post at:// URI", () => {
    expect(() => atUriToBskyUrl(`at://${DID}/app.bsky.feed.like/x`)).toThrow(HedgerowFetchError);
  });
});
