import { TID } from "@atproto/common-web";
import { describe, expect, it, vi } from "vitest";
import {
  RecordConflictError,
  type ConditionalPublisher,
} from "../src/auth.js";
import {
  createSiteAuthor,
  createDocument,
  deleteDocument,
  SITE_AUTHOR_SCOPE,
  startDiscussion,
  updateDocument,
} from "../src/documents.js";
import {
  BSKY_POST_NSID,
  DOCUMENT_NSID,
  PUBLICATION_NSID,
  VIA_KEY,
  VIA_VALUE,
} from "../src/types.js";

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

  it("preserves editor-independent standard and extension fields", async () => {
    const repo = publisher();
    const uri = `at://${DID}/${DOCUMENT_NSID}/3mdocument`;

    await updateDocument(repo, {
      uri,
      cid: "cid-before",
      preserve: {
        $type: DOCUMENT_NSID,
        site: PUBLICATION_URI,
        title: "Before",
        publishedAt: documentInput.publishedAt,
        description: "Remove me",
        tags: ["remove-me"],
        labels: { $type: "com.atproto.label.defs#selfLabels", values: [] },
        coverImage: { $type: "blob", ref: { $link: "bafk-cover" }, mimeType: "image/jpeg", size: 42 },
        contributors: [{ did: DID, role: "author" }],
        "example.com.extension": { retained: true },
      },
      document: { ...documentInput, title: "After" },
    });

    const value = vi.mocked(repo.putRecord).mock.calls[0]![2];
    expect(value).toMatchObject({
      title: "After",
      labels: expect.any(Object),
      coverImage: expect.any(Object),
      contributors: [{ did: DID, role: "author" }],
      "example.com.extension": { retained: true },
    });
    expect(value).not.toHaveProperty("description");
    expect(value).not.toHaveProperty("tags");
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

  it("truncates generated discussion copy to Bluesky's text limit", async () => {
    const repo = publisher();
    const document = {
      uri: `at://${DID}/${DOCUMENT_NSID}/3mdocument`,
      cid: "cid-document",
      value: {
        $type: DOCUMENT_NSID,
        site: PUBLICATION_URI,
        title: "Long title ".repeat(60),
        publishedAt: "2026-08-17T10:00:00.000Z",
      },
    } as const;

    await startDiscussion(repo, {
      document,
      canonicalUrl: "https://example.com/blog/hello",
    });

    const post = vi.mocked(repo.putRecord).mock.calls[0]![2] as { text: string };
    expect([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(post.text)].length).toBeLessThanOrEqual(300);
    expect(post.text.endsWith("…\n\nhttps://example.com/blog/hello")).toBe(true);
  });
});

describe("publication-bound author", () => {
  it("injects publication membership and hides arbitrary record selection", async () => {
    const repo = publisher();
    const author = createSiteAuthor(repo, {
      ownerDid: DID,
      publicationUri: PUBLICATION_URI,
    });

    await author.createDocument({
      path: "/blog/hello",
      title: "Hello",
      publishedAt: "2026-08-17T10:00:00.000Z",
      markdown: "Hello.",
    });

    expect(repo.putRecord).toHaveBeenCalledWith(
      DOCUMENT_NSID,
      expect.any(String),
      expect.objectContaining({ site: PUBLICATION_URI }),
      { swapRecord: null },
    );
    expect(SITE_AUTHOR_SCOPE).toContain(`repo:${DOCUMENT_NSID}`);
    expect(SITE_AUTHOR_SCOPE).not.toContain("transition:generic");
  });

  it("rejects the wrong signed-in account before exposing operations", () => {
    expect(() =>
      createSiteAuthor(publisher({ did: "did:plc:wrong" }), {
        ownerDid: DID,
        publicationUri: PUBLICATION_URI,
      }),
    ).toThrow(/session belongs to did:plc:wrong/);
  });

  it("cannot update or delete another publication's document", async () => {
    const repo = publisher();
    const author = createSiteAuthor(repo, {
      ownerDid: DID,
      publicationUri: PUBLICATION_URI,
    });
    const snapshot = {
      uri: `at://${DID}/${DOCUMENT_NSID}/3motherdoc`,
      cid: "cid-other",
      value: {
        $type: DOCUMENT_NSID,
        site: `at://${DID}/${PUBLICATION_NSID}/3motherpublication`,
        title: "Other",
        publishedAt: "2026-08-17T10:00:00.000Z",
      },
    } as const;

    await expect(author.deleteDocument(snapshot)).rejects.toThrow(/belongs to/);
    await expect(
      author.updateDocument({
        snapshot,
        document: {
          title: "Wrong",
          publishedAt: snapshot.value.publishedAt,
          markdown: "Nope.",
        },
      }),
    ).rejects.toThrow(/belongs to/);
    expect(repo.putRecord).not.toHaveBeenCalled();
    expect(repo.deleteRecord).not.toHaveBeenCalled();
  });

  it("preserves an existing discussion link when an article is edited", async () => {
    const repo = publisher();
    const author = createSiteAuthor(repo, {
      ownerDid: DID,
      publicationUri: PUBLICATION_URI,
    });
    const bskyPostRef = {
      uri: `at://${DID}/${BSKY_POST_NSID}/3mdiscussion`,
      cid: "cid-discussion",
    };
    const snapshot = {
      uri: `at://${DID}/${DOCUMENT_NSID}/3mdocument`,
      cid: "cid-before",
      value: {
        $type: DOCUMENT_NSID,
        site: PUBLICATION_URI,
        title: "Original title",
        publishedAt: "2026-08-17T10:00:00.000Z",
        bskyPostRef,
      },
    };

    await author.updateDocument({
      snapshot,
      document: {
        title: "Corrected title",
        publishedAt: snapshot.value.publishedAt,
        markdown: "Corrected copy.",
      },
    });

    expect(repo.putRecord).toHaveBeenCalledWith(
      DOCUMENT_NSID,
      "3mdocument",
      expect.objectContaining({ bskyPostRef }),
      { swapRecord: "cid-before" },
    );
  });

  it("accepts URL-linked documents when the publication URL is pinned", async () => {
    const repo = publisher();
    const author = createSiteAuthor(repo, {
      ownerDid: DID,
      publicationUri: PUBLICATION_URI,
      publicationUrl: "https://example.com",
    });
    const snapshot = {
      uri: `at://${DID}/${DOCUMENT_NSID}/3mlegacy`,
      cid: "cid-before",
      value: {
        $type: DOCUMENT_NSID,
        site: "https://example.com/",
        title: "Legacy",
        publishedAt: documentInput.publishedAt,
      },
    } as const;

    await expect(author.deleteDocument(snapshot)).resolves.toBeUndefined();
  });
});
