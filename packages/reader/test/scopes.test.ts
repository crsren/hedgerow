import { describe, expect, it } from "vitest";
import {
  BLUESKY_PROFILE_SCOPE,
  IDENTITY_SCOPE,
  SOCIAL_SCOPE,
  combineScopes,
} from "../src/scopes.js";

describe("granular OAuth scopes", () => {
  it("keeps social access to the exact Bluesky records Hedgerow mutates", () => {
    expect(SOCIAL_SCOPE).toContain(IDENTITY_SCOPE);
    expect(SOCIAL_SCOPE).toContain(BLUESKY_PROFILE_SCOPE);
    expect(SOCIAL_SCOPE).toContain("repo:app.bsky.feed.post?action=create");
    expect(SOCIAL_SCOPE).toContain(
      "repo:app.bsky.feed.like?action=create&action=delete",
    );
    expect(SOCIAL_SCOPE).not.toContain("transition:generic");
  });

  it("combines feature scopes deterministically without duplicates", () => {
    expect(
      combineScopes(
        "atproto repo:app.bsky.feed.post?action=create",
        "atproto repo:site.standard.document",
      ),
    ).toBe(
      "atproto repo:app.bsky.feed.post?action=create repo:site.standard.document",
    );
  });
});
