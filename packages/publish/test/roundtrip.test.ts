// The crown-jewel test: the full publish -> PDS -> read loop against an
// in-process PDS (@atproto/dev-env). No Docker, no account, no domain, no
// credentials. Proves the write path that the prototype could never run.
import { AtpAgent } from "@atproto/api";
import { TestNetworkNoAppView } from "@atproto/dev-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentPublisher } from "../src/auth.js";
import { publishSite } from "../src/publish.js";
import { parsePost } from "../src/records.js";
import { readSiteFromPds } from "../src/read.js";

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
