import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LocalDraftConflictError,
  finishDraftPublish,
  listDrafts,
  newDraftKey,
  publishedDraftKey,
  readDraft,
  writeDraft,
  type LocalDraft,
} from "./drafts";

const did = "did:plc:test-author";

function draft(key = newDraftKey(did)): Omit<LocalDraft, "revision"> {
  return {
    key,
    did,
    uri: null,
    baseCid: null,
    title: "Draft",
    markdown: "First",
    path: "/blog/draft",
    description: "",
    tags: [],
    publishedAt: "2026-01-01T00:00:00.000Z",
    savedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(async () => {
  const drafts = await listDrafts(did);
  for (const current of drafts) {
    await finishDraftPublish(current.key, did, current.revision, `at://did:plc:test/site.standard.document/${crypto.randomUUID()}`, "bafyclean");
  }
});

describe("local draft revisions", () => {
  it("rejects stale writes", async () => {
    const first = await writeDraft(draft(), null);
    const { revision: _revision, ...firstInput } = first;
    const second = await writeDraft({ ...firstInput, markdown: "Second" }, first.revision);

    await expect(writeDraft({ ...firstInput, markdown: "Stale" }, first.revision))
      .rejects.toBeInstanceOf(LocalDraftConflictError);
    expect((await readDraft(first.key))?.markdown).toBe(second.markdown);
  });

  it("removes a draft when the published revision is still current", async () => {
    const saved = await writeDraft(draft(), null);
    const uri = "at://did:plc:test-author/site.standard.document/3published";

    await expect(finishDraftPublish(saved.key, did, saved.revision, uri, "bafyremote")).resolves.toBeNull();
    expect(await readDraft(saved.key)).toBeUndefined();
  });

  it("preserves a newer tab revision and attaches it to the published record", async () => {
    const published = await writeDraft(draft(), null);
    const { revision: _revision, ...newerInput } = published;
    const newer = await writeDraft({ ...newerInput, markdown: "Changed during publish" }, published.revision);
    const uri = "at://did:plc:test-author/site.standard.document/3published";

    const retained = await finishDraftPublish(published.key, did, published.revision, uri, "bafyremote");

    expect(retained).toMatchObject({
      key: publishedDraftKey(did, uri),
      uri,
      baseCid: "bafyremote",
      markdown: newer.markdown,
    });
    expect(await readDraft(published.key)).toBeUndefined();
    expect(await readDraft(publishedDraftKey(did, uri))).toMatchObject({ markdown: newer.markdown });
  });
});
