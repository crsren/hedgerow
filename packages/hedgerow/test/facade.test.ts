import { describe, expect, it, vi } from "vitest";
import { createBrowser } from "../src/browser.js";
import { author, permissionScope as siteScope } from "../src/site.js";
import { actor, permissionScope as socialScope } from "../src/social.js";
import { parseMarkdown } from "../src/node.js";
import type { AgentLike, OAuthSessionLike } from "@hedgerow/reader";

const DID = "did:plc:facade";

function authenticatedBrowser() {
  const oauth: OAuthSessionLike = {
    did: DID,
    fetchHandler: vi.fn(async () => new Response()),
    signOut: vi.fn(async () => {}),
    getTokenInfo: vi.fn(async () => ({ scope: siteScope })),
  };
  const putRecord = vi.fn(async ({ collection, rkey }) => ({
    data: { uri: `at://${DID}/${collection}/${rkey}`, cid: "cid-new" },
  }));
  const agent: AgentLike = {
    getProfile: vi.fn(async () => ({ data: { did: DID, handle: "facade.test" } })),
    post: vi.fn(async () => ({ uri: `at://${DID}/app.bsky.feed.post/3mpost`, cid: "cid-post" })),
    like: vi.fn(async () => ({ uri: `at://${DID}/app.bsky.feed.like/3mlike`, cid: "cid-like" })),
    deleteLike: vi.fn(async () => {}),
    listOwnRecords: vi.fn(async () => ({ records: [] })),
    com: {
      atproto: {
        repo: {
          putRecord,
          getRecord: vi.fn(),
          deleteRecord: vi.fn(async () => ({})),
        },
      },
    },
  };
  const browser = createBrowser({
    scope: siteScope,
    createClient: () => ({
      init: vi.fn(async () => ({ session: oauth })),
      signIn: vi.fn(async () => oauth),
    }),
    createAgent: () => agent,
  });
  return { browser, putRecord };
}

describe("curated Hedgerow facade", () => {
  it("binds authoring to a configured publication", async () => {
    const { browser, putRecord } = authenticatedBrowser();
    const session = await browser.restore();
    const publicationUri = `at://${DID}/site.standard.publication/3mpublication`;
    const siteAuthor = author(session!, { ownerDid: DID, publicationUri });

    await siteAuthor.createDocument({
      path: "/blog/hello",
      title: "Hello",
      publishedAt: "2026-08-17T10:00:00.000Z",
      markdown: "Hello.",
    });

    expect(putRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: DID,
        collection: "site.standard.document",
        record: expect.objectContaining({ site: publicationUri }),
        swapRecord: null,
      }),
    );
  });

  it("binds social actions without exposing generic writes", async () => {
    const { browser } = authenticatedBrowser();
    const session = await browser.restore();
    const socialActor = actor(session!);

    expect(socialActor.did).toBe(DID);
    expect("putRecord" in socialActor).toBe(false);
    expect(socialScope).not.toContain("transition:generic");

    await browser.signOut();
    await expect(
      socialActor.createReply({
        root: { uri: "at://did:plc:root/app.bsky.feed.post/3mroot", cid: "cid-root" },
        parent: { uri: "at://did:plc:root/app.bsky.feed.post/3mroot", cid: "cid-root" },
        text: "After logout",
      }),
    ).rejects.toThrow(/after sign-out/);
  });

  it("keeps frontmatter parsing in the Node entry point", () => {
    expect(
      parseMarkdown(
        "---\ntitle: Hello\npublishedAt: 2026-08-17\n---\nBody",
        "hello",
      ),
    ).toMatchObject({ slug: "hello", title: "Hello", body: "Body" });
  });
});
