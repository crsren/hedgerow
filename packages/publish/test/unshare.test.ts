// Unit coverage for unshare's edge paths, using a stub Publisher (no PDS boot).
// The happy path — delete the share, strip the anchor — is proved end-to-end in
// roundtrip.test.ts; here we drive the failure/branch cases that a real PDS is
// awkward to force: a share post that's already gone, an anchor that points
// elsewhere, a document read that fails, a tracked share with no document, and
// a structurally broken share uri.
import { describe, expect, it, vi } from "vitest";
import type { Publisher } from "../src/auth.js";
import { unshare, type PublishState } from "../src/publish.js";
import { DOCUMENT_NSID } from "../src/types.js";

const SHARE_URI = "at://did:plc:me/app.bsky.feed.post/shareRkey";
const SHARE = { uri: SHARE_URI, cid: "bafyshare" };

/** A Publisher whose three methods are individually overridable spies. */
function fakePublisher(over: Partial<Publisher> = {}): Publisher {
  return {
    did: "did:plc:me",
    putRecord: vi.fn(async () => ({ uri: "at://x", cid: "c" })),
    getRecord: vi.fn(async () => null),
    deleteRecord: vi.fn(async () => {}),
    ...over,
  };
}

/** State with one shared, anchored slug tracked. */
function stateWith(overrides: Partial<PublishState> = {}): PublishState {
  return {
    publication: null,
    docs: { "post-a": "docRkeyA" },
    shares: { "post-a": SHARE },
    ...overrides,
  };
}

describe("unshare edge paths", () => {
  it("warns but still cleans state when the share post is already gone", async () => {
    const deleteRecord = vi.fn(async () => {
      throw new Error("RecordNotFound");
    });
    // Document still anchored to this share, so the anchor is stripped anyway.
    const getRecord = vi.fn(async () => ({ title: "A", bskyPostRef: SHARE }));
    const putRecord = vi.fn(async () => ({ uri: "at://x", cid: "c" }));
    const pub = fakePublisher({ deleteRecord, getRecord, putRecord });

    const res = await unshare(pub, "post-a", stateWith());

    expect(res.removed).toBe(false);
    expect(res.warnings.some((w) => w.includes("already gone"))).toBe(true);
    expect(res.state.shares["post-a"]).toBeUndefined();
    // anchor removal still happened (the document no longer points at the share)
    const putBody = (putRecord.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(putBody.bskyPostRef).toBeUndefined();
    expect(putBody.updatedAt).toBeDefined();
  });

  it("leaves a document alone when its anchor points at a different post", async () => {
    // Author has re-pointed the anchor since; we must not clobber it.
    const getRecord = vi.fn(async () => ({
      title: "A",
      bskyPostRef: { uri: "at://did:plc:me/app.bsky.feed.post/OTHER", cid: "x" },
    }));
    const putRecord = vi.fn(async () => ({ uri: "at://x", cid: "c" }));
    const pub = fakePublisher({ getRecord, putRecord });

    const res = await unshare(pub, "post-a", stateWith());

    expect(res.removed).toBe(true);
    expect(putRecord).not.toHaveBeenCalled();
    expect(res.warnings).toEqual([]);
    expect(res.state.shares["post-a"]).toBeUndefined();
  });

  it("warns when the document read/rewrite fails, but the share is still removed", async () => {
    const getRecord = vi.fn(async () => {
      throw new Error("PDS unavailable");
    });
    const pub = fakePublisher({ getRecord });

    const res = await unshare(pub, "post-a", stateWith());

    expect(res.removed).toBe(true);
    expect(res.warnings.some((w) => w.includes("could not rewrite document"))).toBe(true);
    expect(res.state.shares["post-a"]).toBeUndefined();
  });

  it("warns and cleans state when a share is tracked but no document is", async () => {
    const getRecord = vi.fn();
    const pub = fakePublisher({ getRecord });
    // shares has the slug, docs does not.
    const state = stateWith({ docs: {} });

    const res = await unshare(pub, "post-a", state);

    expect(res.removed).toBe(true);
    expect(getRecord).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => w.includes("no document tracked"))).toBe(true);
    expect(res.state.shares["post-a"]).toBeUndefined();
  });

  it("only touches the document collection when stripping the anchor", async () => {
    const getRecord = vi.fn(async () => ({ title: "A", bskyPostRef: SHARE }));
    const pub = fakePublisher({ getRecord });
    await unshare(pub, "post-a", stateWith());
    expect(getRecord).toHaveBeenCalledWith(DOCUMENT_NSID, "docRkeyA");
  });

  it("throws on a structurally broken share uri (no derivable rkey)", async () => {
    const pub = fakePublisher();
    const state = stateWith({ shares: { "post-a": { uri: "", cid: "c" } } });
    await expect(unshare(pub, "post-a", state)).rejects.toThrow(/malformed share uri/);
  });
});
