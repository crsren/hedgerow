import { TID } from "@atproto/common-web";
import { describe, expect, it, vi } from "vitest";
import {
  RecordConflictError,
  type ConditionalPublisher,
} from "../src/auth.js";
import {
  createDocument,
  deleteDocument,
  startDiscussion,
  updateDocument,
} from "../src/documents.js";
import { BSKY_POST_NSID, DOCUMENT_NSID, VIA_KEY, VIA_VALUE } from "../src/types.js";

const DID = "did:plc:author";
const PUBLICATION_URI = `at://${DID}/site.standard.publication/3mpublication`;

function publisher(overrides: Partial<ConditionalPublisher> = {}): ConditionalPublisher {
  return {
    did: DID,
    supportsSwapRecord: true,
    putRecord: vi.fn(async (collection, rkey) => ({
      uri: `at://${DID}/${collection}/${rkey}`,
      cid: `cid-${rkey}`,
    })),
    getRecord: vi.fn(async () => null),
    getRecordWithCid: vi.fn(async () => null),
    deleteRecord: vi.fn(async () => {}),
    ...overrides,
  };
}

const documentInput = {
  site: PUBLICATION_URI,
  path: "/blog/hello",
  title: "Hello",
  publishedAt: "2026-08-17T10:00:00.000Z",
  markdown: "Hello **world**.",
};

describe("single-document operations", () => {
  it("creates under a TID with create-only CAS and complete Markdown mirrors", async () => {
    const repo = publisher();

    const created = await createDocument(repo, documentInput);

    const call = vi.mocked(repo.putRecord).mock.calls[0]!;
    expect(call[0]).toBe(DOCUMENT_NSID);
    expect(() => TID.fromStr(call[1])).not.toThrow();
    expect(call[3]).toEqual({ swapRecord: null });
    expect(created.value.content).toEqual({
      $type: "pub.hedgerow.content.markdown",
      markdown: documentInput.markdown,
    });
    expect(created.value.textContent).toBe("Hello world.");
    expect(created.value[VIA_KEY]).toBe(VIA_VALUE);
  });

  it("updates the same record using the loaded CID", async () => {
    const repo = publisher();
    const uri = `at://${DID}/${DOCUMENT_NSID}/3mdocument`;

    const updated = await updateDocument(repo, {
      uri,
      cid: "cid-before",
      document: { ...documentInput, title: "Corrected" },
    });

    expect(repo.putRecord).toHaveBeenCalledWith(
      DOCUMENT_NSID,
      "3mdocument",
      expect.objectContaining({ title: "Corrected", updatedAt: expect.any(String) }),
      { swapRecord: "cid-before" },
    );
    expect(updated.uri).toBe(uri);
  });

  it("deletes only the loaded version", async () => {
    const repo = publisher();
    const uri = `at://${DID}/${DOCUMENT_NSID}/3mdocument`;

    await deleteDocument(repo, { uri, cid: "cid-before" });

    expect(repo.deleteRecord).toHaveBeenCalledWith(DOCUMENT_NSID, "3mdocument", {
      swapRecord: "cid-before",
    });
  });

  it("rejects writes to a document owned by another DID", async () => {
    const repo = publisher();
    await expect(
      updateDocument(repo, {
        uri: `at://did:plc:other/${DOCUMENT_NSID}/3mdocument`,
        cid: "cid-before",
        document: documentInput,
      }),
    ).rejects.toThrow(/owned by did:plc:other/);
    expect(repo.putRecord).not.toHaveBeenCalled();
  });
});

describe("startDiscussion", () => {
  it("creates a Bluesky post and links its strong ref with document CAS", async () => {
    const repo = publisher();
    const document = {
      uri: `at://${DID}/${DOCUMENT_NSID}/3mdocument`,
      cid: "cid-document",
      value: {
        $type: DOCUMENT_NSID,
        site: PUBLICATION_URI,
        title: "Hello",
        path: "/blog/hello",
        publishedAt: "2026-08-17T10:00:00.000Z",
      },
    } as const;

    const result = await startDiscussion(repo, {
      document,
      canonicalUrl: "https://example.com/blog/hello",
    });

    expect(repo.putRecord).toHaveBeenNthCalledWith(
      1,
      BSKY_POST_NSID,
      expect.any(String),
      expect.objectContaining({ text: "Hello\n\nhttps://example.com/blog/hello" }),
      { swapRecord: null },
    );
    expect(repo.putRecord).toHaveBeenNthCalledWith(
      2,
      DOCUMENT_NSID,
      "3mdocument",
      expect.objectContaining({ bskyPostRef: result.post }),
      { swapRecord: "cid-document" },
    );
  });

  it("removes the new post if linking loses a race", async () => {
    const putRecord = vi.fn(async (collection: string, rkey: string) => {
      if (collection === DOCUMENT_NSID) {
        throw new RecordConflictError("stale document", "cid-document");
      }
      return { uri: `at://${DID}/${collection}/${rkey}`, cid: "cid-post" };
    });
    const repo = publisher({ putRecord });
    const document = {
      uri: `at://${DID}/${DOCUMENT_NSID}/3mdocument`,
      cid: "cid-document",
      value: {
        $type: DOCUMENT_NSID,
        site: PUBLICATION_URI,
        title: "Hello",
        publishedAt: "2026-08-17T10:00:00.000Z",
      },
    } as const;

    await expect(
      startDiscussion(repo, { document, canonicalUrl: "https://example.com/hello" }),
    ).rejects.toBeInstanceOf(RecordConflictError);

    expect(repo.deleteRecord).toHaveBeenCalledWith(
      BSKY_POST_NSID,
      expect.any(String),
      { swapRecord: "cid-post" },
    );
  });
});
