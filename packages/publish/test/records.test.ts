import { describe, expect, it } from "vitest";
import {
  documentRecord,
  parsePost,
  publicationRecord,
  toPlainText,
} from "../src/records.js";
import { VIA_KEY, VIA_VALUE } from "../src/types.js";

const POST = `---
title: "Back to Web One"
slug: back-to-web-one
publishedAt: 2026-07-19T10:00:00.000Z
description: "Owning your words again."
tags: [atproto, web]
---
The web used to be a place you **owned**. See [the point](https://example.com).

# A heading

- a bullet
`;

describe("parsePost", () => {
  it("reads frontmatter and body", () => {
    const p = parsePost(POST, "fallback");
    expect(p.slug).toBe("back-to-web-one");
    expect(p.title).toBe("Back to Web One");
    expect(p.publishedAt).toBe("2026-07-19T10:00:00.000Z");
    expect(p.tags).toEqual(["atproto", "web"]);
    expect(p.body).toContain("The web used to be");
  });

  it("falls back to the given slug", () => {
    const p = parsePost("---\ntitle: T\npublishedAt: 2026-01-01\n---\nbody", "my-slug");
    expect(p.slug).toBe("my-slug");
  });

  it("throws without a title", () => {
    expect(() => parsePost("---\npublishedAt: 2026-01-01\n---\nx", "s")).toThrow(/title/);
  });

  it("reads a bare bskyPostUri from frontmatter", () => {
    const p = parsePost(
      `---
title: T
publishedAt: 2026-01-01
bskyPostUri: https://bsky.app/profile/chris.test/post/3abc
---
body`,
      "s",
    );
    expect(p.bskyPostUri).toBe("https://bsky.app/profile/chris.test/post/3abc");
    expect(p.bskyPostRef).toBeUndefined();
  });

  it("reads draft: true and leaves it absent otherwise", () => {
    const draft = parsePost("---\ntitle: T\npublishedAt: 2026-01-01\ndraft: true\n---\nx", "s");
    expect(draft.draft).toBe(true);
    const notDraft = parsePost("---\ntitle: T\npublishedAt: 2026-01-01\n---\nx", "s");
    expect(notDraft.draft).toBeUndefined();
  });

  it("distinguishes share: false from an absent share", () => {
    const off = parsePost("---\ntitle: T\npublishedAt: 2026-01-01\nshare: false\n---\nx", "s");
    expect(off.share).toBe(false);
    const on = parsePost("---\ntitle: T\npublishedAt: 2026-01-01\nshare: true\n---\nx", "s");
    expect(on.share).toBe(true);
    const absent = parsePost("---\ntitle: T\npublishedAt: 2026-01-01\n---\nx", "s");
    expect(absent.share).toBeUndefined();
  });

  it("keeps an explicit bskyPostRef alongside a bskyPostUri (ref wins downstream)", () => {
    const p = parsePost(
      `---
title: T
publishedAt: 2026-01-01
bskyPostUri: at://did:plc:x/app.bsky.feed.post/3abc
bskyPostRef:
  uri: at://did:plc:x/app.bsky.feed.post/3abc
  cid: bafyexplicit
---
body`,
      "s",
    );
    expect(p.bskyPostUri).toBe("at://did:plc:x/app.bsky.feed.post/3abc");
    expect(p.bskyPostRef).toEqual({
      uri: "at://did:plc:x/app.bsky.feed.post/3abc",
      cid: "bafyexplicit",
    });
  });
});

describe("publicationRecord", () => {
  it("strips a trailing slash from url", () => {
    const rec = publicationRecord({ url: "https://crsren.com/", name: "crsren" });
    expect(rec.url).toBe("https://crsren.com");
    expect(rec.$type).toBe("site.standard.publication");
  });
});

describe("toPlainText", () => {
  it("removes markdown syntax", () => {
    const txt = toPlainText("# H\n\n**bold** and [link](https://x.com)\n\n- item");
    expect(txt).not.toContain("#");
    expect(txt).not.toContain("**");
    expect(txt).not.toContain("](");
    expect(txt).toContain("bold");
    expect(txt).toContain("link");
    expect(txt).toContain("item");
  });
});

describe("documentRecord", () => {
  it("shapes a document with path and plaintext content", () => {
    const post = parsePost(POST, "fallback");
    const rec = documentRecord(post, { siteUri: "at://did:plc:x/site.standard.publication/abc" });
    expect(rec.$type).toBe("site.standard.document");
    expect(rec.site).toBe("at://did:plc:x/site.standard.publication/abc");
    expect(rec.path).toBe("/back-to-web-one");
    expect(rec.title).toBe("Back to Web One");
    expect(rec.textContent).toContain("The web used to be");
    expect(rec.textContent).not.toContain("**");
  });

  it("also emits the rich pub.hedgerow.content.markdown member from the markdown source (SLIMS-64)", () => {
    const post = parsePost(POST, "fallback");
    const rec = documentRecord(post, { siteUri: "at://did:plc:x/site.standard.publication/abc" });
    expect(rec.content).toEqual({ $type: "pub.hedgerow.content.markdown", markdown: post.body });
    // The plaintext mirror is always present alongside the rich member.
    expect(rec.textContent).toBe(toPlainText(post.body));
  });

  it("stamps tool attribution on every document (SLIMS-71)", () => {
    const rec = documentRecord(parsePost(POST, "fallback"), {
      siteUri: "at://did:plc:x/site.standard.publication/abc",
    });
    expect(rec[VIA_KEY]).toBe(VIA_VALUE);
    // Pinned literally, not via the constants: the key and value ARE the
    // contract a downstream filter matches on, so renaming either is a
    // breaking change to records already in the wild and should fail here
    // rather than silently re-stamp everyone's repo on the next publish.
    expect(rec["pub.hedgerow.via"]).toBe("@hedgerow/publish");
  });

  it("keeps the stamp constant, so republishing an unchanged post stays a no-op", () => {
    // publishSite skips the write when the record it builds matches the live
    // one (updatedAt aside), so anything varying in the stamp — a version, a
    // timestamp — would rewrite every document on every release and bump
    // updatedAt on posts nobody touched.
    const opts = { siteUri: "at://did:plc:x/site.standard.publication/abc" };
    const a = documentRecord(parsePost(POST, "fallback"), opts);
    const b = documentRecord(parsePost(POST, "fallback"), opts);
    expect(a[VIA_KEY]).toBe(b[VIA_KEY]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
