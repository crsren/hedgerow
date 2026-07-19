// The crown-jewel test: the full publish -> PDS -> read loop against an
// in-process PDS (@atproto/dev-env). No Docker, no account, no domain, no
// credentials. Proves the write path that the prototype could never run.
import { AtpAgent } from "@atproto/api";
import { TID } from "@atproto/common-web";
import { TestNetworkNoAppView } from "@atproto/dev-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentPublisher } from "../src/auth.js";
import { emptyState, publishSite, unshare, type PublishState } from "../src/publish.js";
import { parsePost } from "../src/records.js";
import { listRecords, readSiteFromPds } from "../src/read.js";

const POST = `---
title: "Back to Web One"
slug: back-to-web-one
publishedAt: 2026-07-19T10:00:00.000Z
description: "Owning your words again."
tags: [atproto, web]
---
The web used to be a place you owned.
`;

let net: TestNetworkNoAppView;
let agent: AtpAgent;
let did: string;
let pdsUrl: string;

beforeAll(async () => {
  net = await TestNetworkNoAppView.create();
  pdsUrl = net.pds.url;
  agent = new AtpAgent({ service: pdsUrl });
  const account = await agent.createAccount({
    handle: "chris.test",
    email: "chris@test.local",
    password: "hunter2hunter2",
  });
  did = account.data.did;
});

afterAll(async () => {
  await net?.close();
});

describe("publish -> read round trip (local PDS)", () => {
  it("publishes records and reads them back with fidelity", async () => {
    const publisher = agentPublisher(agent);
    const posts = [parsePost(POST, "back-to-web-one")];

    const result = await publishSite(
      publisher,
      { url: "https://crsren.com", name: "crsren", description: "A personal site on the open network." },
      posts,
    );

    expect(result.publicationUri).toContain("site.standard.publication");
    expect(result.documents).toHaveLength(1);

    const site = await readSiteFromPds(pdsUrl, did);

    expect(site.publication?.name).toBe("crsren");
    expect(site.publication?.url).toBe("https://crsren.com");
    expect(site.documents).toHaveLength(1);

    expect(site.publicationUri).toBe(result.publicationUri);
    const doc = site.documents[0]!;
    expect(doc.uri).toBe(result.documents[0]!.uri);
    expect(doc.value.title).toBe("Back to Web One");
    expect(doc.value.path).toBe("/back-to-web-one");
    expect(doc.value.site).toBe(result.publicationUri);
    expect(doc.value.textContent).toContain("The web used to be");
    expect(doc.value.tags).toEqual(["atproto", "web"]);
  });

  it("is idempotent: re-publishing with saved state reuses rkeys and skips unchanged writes", async () => {
    const publisher = agentPublisher(agent);
    const posts = [parsePost(POST, "back-to-web-one")];

    const first = await publishSite(publisher, { url: "https://crsren.com", name: "crsren" }, posts);
    const countAfterFirst = (await readSiteFromPds(pdsUrl, did)).documents.length;

    const second = await publishSite(
      publisher,
      { url: "https://crsren.com", name: "crsren" },
      posts,
      first.state,
    );

    // same records, nothing rewritten, nothing duplicated
    expect(second.publicationUri).toBe(first.publicationUri);
    expect(second.documents[0]!.uri).toBe(first.documents[0]!.uri);
    expect(second.documents[0]!.changed).toBe(false);
    const after = await readSiteFromPds(pdsUrl, did);
    expect(after.documents).toHaveLength(countAfterFirst);
    // unchanged republish must not stamp updatedAt
    const doc = after.documents.find((d) => d.value.path === "/back-to-web-one");
    expect(doc?.value.updatedAt).toBeUndefined();
  });

  it("stamps updatedAt only when content actually changes", async () => {
    const publisher = agentPublisher(agent);
    const posts = [parsePost(POST, "changing-post")];
    // separate slug so this test owns its own record
    posts[0]!.slug = "changing-post";

    const first = await publishSite(publisher, { url: "https://crsren.com", name: "crsren" }, posts);
    const edited = [{ ...posts[0]!, body: "Edited body." }];
    const second = await publishSite(
      publisher,
      { url: "https://crsren.com", name: "crsren" },
      edited,
      first.state,
    );

    expect(second.documents[0]!.changed).toBe(true);
    const site = await readSiteFromPds(pdsUrl, did);
    const doc = site.documents.find((d) => d.value.path === "/changing-post");
    expect(doc?.value.textContent).toBe("Edited body.");
    expect(doc?.value.updatedAt).toBeDefined();
  });
});

describe("bskyPostUri -> bskyPostRef resolution during publish", () => {
  it("resolves a real post's at-uri to a StrongRef with the actual cid", async () => {
    const publisher = agentPublisher(agent);

    // Create a real app.bsky.feed.post on the same PDS; putRecord returns its cid.
    const rkey = TID.nextStr();
    const created = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: "app.bsky.feed.post",
      rkey,
      record: { $type: "app.bsky.feed.post", text: "canonical thread", createdAt: new Date().toISOString() },
    });
    const postUri = `at://${did}/app.bsky.feed.post/${rkey}`;

    const post = parsePost(
      `---
title: "Anchored Post"
slug: anchored-post
publishedAt: 2026-07-19T10:00:00.000Z
bskyPostUri: ${postUri}
---
Comments live on Bluesky.
`,
      "anchored-post",
    );

    // resolveOpts.pds points the resolver at the local PDS (no network DID-doc lookup).
    const result = await publishSite(
      publisher,
      { url: "https://crsren.com", name: "crsren" },
      [post],
      undefined,
      { resolveOpts: { pds: pdsUrl } },
    );
    expect(result.warnings).toEqual([]);

    const site = await readSiteFromPds(pdsUrl, did);
    const readDoc = site.documents.find((d) => d.value.path === "/anchored-post");
    expect(readDoc?.value.bskyPostRef).toEqual({ uri: postUri, cid: created.data.cid });
  });

  it("does not abort the publish when a bskyPostUri can't be resolved", async () => {
    const publisher = agentPublisher(agent);
    const post = parsePost(
      `---
title: "Dangling Anchor"
slug: dangling-anchor
publishedAt: 2026-07-19T10:00:00.000Z
bskyPostUri: at://${did}/app.bsky.feed.post/${TID.nextStr()}
---
This post's anchor is missing.
`,
      "dangling-anchor",
    );

    const result = await publishSite(
      publisher,
      { url: "https://crsren.com", name: "crsren" },
      [post],
      undefined,
      { resolveOpts: { pds: pdsUrl } },
    );

    // published, but with a warning and no ref
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("dangling-anchor");
    const site = await readSiteFromPds(pdsUrl, did);
    const readDoc = site.documents.find((d) => d.value.path === "/dangling-anchor");
    expect(readDoc).toBeDefined();
    expect(readDoc?.value.bskyPostRef).toBeUndefined();
  });
});

// The share posts these tests mint share one PDS/account, so counts are compared
// as deltas rather than absolutes.
type FeedPost = {
  embed?: { external?: { uri?: string; title?: string; description?: string } };
};
const CFG = { url: "https://crsren.com", name: "crsren" };

describe("auto-share: minting a canonical Bluesky post", () => {
  it("creates exactly one share post and anchors the document to it", async () => {
    const publisher = agentPublisher(agent);
    const post = parsePost(
      `---
title: "Shared Post"
slug: shared-post
publishedAt: 2026-07-19T10:00:00.000Z
description: "A post that shares itself."
---
Body.
`,
      "shared-post",
    );

    const before = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");
    const result = await publishSite(publisher, CFG, [post], undefined, {
      share: { enabled: true },
    });
    const after = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");

    // exactly one new app.bsky.feed.post
    expect(after.length - before.length).toBe(1);

    const canonicalUrl = "https://crsren.com/shared-post";
    const share = after.find((r) => r.value.embed?.external?.uri === canonicalUrl);
    expect(share).toBeDefined();
    expect(share!.value.embed!.external!.title).toBe("Shared Post");

    // state persisted the share ref
    expect(result.state.shares["shared-post"]).toEqual({ uri: share!.uri, cid: share!.cid });

    // the document's read-back bskyPostRef matches the share post's uri+cid
    const site = await readSiteFromPds(pdsUrl, did);
    const doc = site.documents.find((d) => d.value.path === "/shared-post");
    expect(doc?.value.bskyPostRef).toEqual({ uri: share!.uri, cid: share!.cid });
  });

  it("reuses the persisted share on rerun — no duplicate, document unchanged", async () => {
    const publisher = agentPublisher(agent);
    const post = parsePost(
      `---
title: "Reshared Post"
slug: reshare-post
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "reshare-post",
    );

    const first = await publishSite(publisher, CFG, [post], undefined, {
      share: { enabled: true },
    });
    const before = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");
    const second = await publishSite(publisher, CFG, [post], first.state, {
      share: { enabled: true },
    });
    const after = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");

    expect(after.length).toBe(before.length); // no second share post
    expect(second.documents[0]!.changed).toBe(false);
    expect(second.state.shares["reshare-post"]).toEqual(first.state.shares["reshare-post"]);
  });

  it("honors a custom share text function", async () => {
    const publisher = agentPublisher(agent);
    const post = parsePost(
      `---
title: "Custom Text Post"
slug: custom-text-post
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "custom-text-post",
    );

    const result = await publishSite(publisher, CFG, [post], undefined, {
      share: { enabled: true, text: (p, url) => `New: ${p.title} → ${url}` },
    });

    const ref = result.state.shares["custom-text-post"]!;
    const rkey = ref.uri.split("/").pop()!;
    const got = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: "app.bsky.feed.post",
      rkey,
    });
    expect((got.data.value as { text: string }).text).toBe(
      "New: Custom Text Post → https://crsren.com/custom-text-post",
    );
  });

  it("does not create a share when the post has an explicit bskyPostUri", async () => {
    const publisher = agentPublisher(agent);
    const rkey = TID.nextStr();
    const created = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: "app.bsky.feed.post",
      rkey,
      record: { $type: "app.bsky.feed.post", text: "explicit", createdAt: new Date().toISOString() },
    });
    const postUri = `at://${did}/app.bsky.feed.post/${rkey}`;
    const post = parsePost(
      `---
title: "Explicitly Anchored"
slug: explicit-anchor
publishedAt: 2026-07-19T10:00:00.000Z
bskyPostUri: ${postUri}
---
Body.
`,
      "explicit-anchor",
    );

    // measured after we minted the explicit post, so any delta is share-created
    const before = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");
    const result = await publishSite(publisher, CFG, [post], undefined, {
      share: { enabled: true },
      resolveOpts: { pds: pdsUrl },
    });
    const after = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");

    expect(after.length - before.length).toBe(0); // no share minted
    expect(result.state.shares["explicit-anchor"]).toBeUndefined();

    const site = await readSiteFromPds(pdsUrl, did);
    const doc = site.documents.find((d) => d.value.path === "/explicit-anchor");
    expect(doc?.value.bskyPostRef).toEqual({ uri: postUri, cid: created.data.cid });
  });

  it("loads old state without a shares field", async () => {
    const publisher = agentPublisher(agent);
    const post = parsePost(
      `---
title: "Legacy State Post"
slug: legacy-state
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "legacy-state",
    );

    const first = await publishSite(publisher, CFG, [post]);
    // simulate a state file written before the shares field existed
    const legacy = { publication: first.state.publication, docs: first.state.docs };
    const second = await publishSite(publisher, CFG, [post], legacy as unknown as PublishState);

    expect(second.documents[0]!.changed).toBe(false);
    expect(second.state.shares).toEqual({});
  });
});

describe("prune: removing orphaned documents", () => {
  it("deletes documents no longer present, cleans state, leaves the survivor", async () => {
    const publisher = agentPublisher(agent);
    const keep = parsePost(
      `---
title: "Prune Keep"
slug: prune-keep
publishedAt: 2026-07-19T10:00:00.000Z
---
Kept.
`,
      "prune-keep",
    );
    const orphan = parsePost(
      `---
title: "Prune Orphan"
slug: prune-orphan
publishedAt: 2026-07-19T10:00:00.000Z
---
Orphaned.
`,
      "prune-orphan",
    );

    const first = await publishSite(publisher, CFG, [keep, orphan], undefined, {
      share: { enabled: true },
    });
    expect(first.pruned).toEqual([]); // prune off by default

    const second = await publishSite(publisher, CFG, [keep], first.state, { prune: true });

    expect(second.pruned).toEqual(["prune-orphan"]);
    expect(second.state.docs["prune-orphan"]).toBeUndefined();
    expect(second.state.docs["prune-keep"]).toBeDefined();
    // the pruned doc's share ref is deliberately retained
    expect(second.state.shares["prune-orphan"]).toBeDefined();

    const site = await readSiteFromPds(pdsUrl, did);
    expect(site.documents.find((d) => d.value.path === "/prune-orphan")).toBeUndefined();
    expect(site.documents.find((d) => d.value.path === "/prune-keep")).toBeDefined();
  });

  it("prunes nothing when every state slug is still published", async () => {
    const publisher = agentPublisher(agent);
    const post = parsePost(
      `---
title: "Prune Noop"
slug: prune-noop
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "prune-noop",
    );

    const first = await publishSite(publisher, CFG, [post]);
    const second = await publishSite(publisher, CFG, [post], first.state, { prune: true });

    expect(second.pruned).toEqual([]);
    const site = await readSiteFromPds(pdsUrl, did);
    expect(site.documents.find((d) => d.value.path === "/prune-noop")).toBeDefined();
  });
});

describe("draft: skipping posts", () => {
  it("skips a draft entirely — no record, no share, reported in skipped", async () => {
    const publisher = agentPublisher(agent);
    const normal = parsePost(
      `---
title: "Live One"
slug: draft-live
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "draft-live",
    );
    const draft = parsePost(
      `---
title: "Work In Progress"
slug: pure-draft
publishedAt: 2026-07-19T10:00:00.000Z
draft: true
---
Not ready.
`,
      "pure-draft",
    );

    const result = await publishSite(publisher, CFG, [normal, draft], undefined, {
      share: { enabled: true },
    });

    expect(result.skipped).toEqual(["pure-draft"]);
    // the draft never reaches the documents list, and no share was minted for it
    expect(result.documents.map((d) => d.slug)).toEqual(["draft-live"]);
    expect(result.state.shares["pure-draft"]).toBeUndefined();

    const site = await readSiteFromPds(pdsUrl, did);
    expect(site.documents.find((d) => d.value.path === "/pure-draft")).toBeUndefined();
    expect(site.documents.find((d) => d.value.path === "/draft-live")).toBeDefined();
  });

  it("keeps a published post flipped to draft — not pruned even with prune:true", async () => {
    const publisher = agentPublisher(agent);
    const live = parsePost(
      `---
title: "Flip Me"
slug: flip-draft
publishedAt: 2026-07-19T10:00:00.000Z
---
Published body.
`,
      "flip-draft",
    );

    const first = await publishSite(publisher, CFG, [live]);
    expect(
      (await readSiteFromPds(pdsUrl, did)).documents.find((d) => d.value.path === "/flip-draft"),
    ).toBeDefined();

    const drafted = parsePost(
      `---
title: "Flip Me"
slug: flip-draft
publishedAt: 2026-07-19T10:00:00.000Z
draft: true
---
Published body.
`,
      "flip-draft",
    );
    const second = await publishSite(publisher, CFG, [drafted], first.state, { prune: true });

    expect(second.skipped).toEqual(["flip-draft"]);
    expect(second.pruned).toEqual([]);
    // record is still tracked in state and still live on the PDS
    expect(second.state.docs["flip-draft"]).toBe(first.state.docs["flip-draft"]);
    const site = await readSiteFromPds(pdsUrl, did);
    expect(site.documents.find((d) => d.value.path === "/flip-draft")).toBeDefined();
  });
});

describe("share: false opts out of auto-share", () => {
  it("writes the record but mints no share post, while its peer still shares", async () => {
    const publisher = agentPublisher(agent);
    const shared = parsePost(
      `---
title: "Will Share"
slug: will-share
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "will-share",
    );
    const noShare = parsePost(
      `---
title: "Quiet Post"
slug: no-share
publishedAt: 2026-07-19T10:00:00.000Z
share: false
---
Body.
`,
      "no-share",
    );

    const before = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");
    const result = await publishSite(publisher, CFG, [shared, noShare], undefined, {
      share: { enabled: true },
    });
    const after = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");

    // exactly one new feed post — from `will-share`, not `no-share`
    expect(after.length - before.length).toBe(1);
    expect(result.state.shares["will-share"]).toBeDefined();
    expect(result.state.shares["no-share"]).toBeUndefined();

    // both documents are written; only the sharing one carries an anchor
    const site = await readSiteFromPds(pdsUrl, did);
    expect(site.documents.find((d) => d.value.path === "/will-share")?.value.bskyPostRef).toBeDefined();
    const quiet = site.documents.find((d) => d.value.path === "/no-share");
    expect(quiet).toBeDefined();
    expect(quiet?.value.bskyPostRef).toBeUndefined();
  });
});

describe("unshare: undoing an auto-share", () => {
  it("deletes the share post, strips the document anchor, cleans state", async () => {
    const publisher = agentPublisher(agent);
    const post = parsePost(
      `---
title: "Unshare Me"
slug: unshare-me
publishedAt: 2026-07-19T10:00:00.000Z
---
Body.
`,
      "unshare-me",
    );

    const first = await publishSite(publisher, CFG, [post], undefined, { share: { enabled: true } });
    const shareRef = first.state.shares["unshare-me"];
    expect(shareRef).toBeDefined();

    // preconditions: share post exists on the PDS and the doc anchors to it
    const listed = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");
    expect(listed.find((r) => r.uri === shareRef!.uri)).toBeDefined();
    const doc0 = (await readSiteFromPds(pdsUrl, did)).documents.find(
      (d) => d.value.path === "/unshare-me",
    );
    expect(doc0?.value.bskyPostRef).toEqual(shareRef);

    const res = await unshare(publisher, "unshare-me", first.state);
    expect(res.removed).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.state.shares["unshare-me"]).toBeUndefined();

    // share post is gone, and the doc read-back no longer carries the anchor
    const afterList = await listRecords<FeedPost>(pdsUrl, did, "app.bsky.feed.post");
    expect(afterList.find((r) => r.uri === shareRef!.uri)).toBeUndefined();
    const doc1 = (await readSiteFromPds(pdsUrl, did)).documents.find(
      (d) => d.value.path === "/unshare-me",
    );
    expect(doc1).toBeDefined();
    expect(doc1?.value.bskyPostRef).toBeUndefined();
  });

  it("is a graceful no-op for a slug that was never shared", async () => {
    const publisher = agentPublisher(agent);
    const res = await unshare(publisher, "never-shared", emptyState());
    expect(res.removed).toBe(false);
    expect(res.state.shares["never-shared"]).toBeUndefined();
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("never-shared");
  });
});
