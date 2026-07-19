import { describe, expect, it } from "vitest";
import {
  documentRecord,
  parsePost,
  publicationRecord,
  toPlainText,
} from "../src/records.js";

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
});
