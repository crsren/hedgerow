// The barrel re-exports every public entry point. Import the package surface
// once and assert the key names resolve — a guard against a re-export being
// dropped or renamed out of the published API.
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("public API surface", () => {
  it("re-exports the read functions, error class, and constants", () => {
    for (const name of [
      "fetchThread",
      "fetchLikes",
      "resolvePostUri",
      "resolveHandle",
      "atUriToBskyUrl",
      "clearHandleCache",
      "sortReplies",
      "xrpcGet",
    ] as const) {
      expect(typeof api[name]).toBe("function");
    }
    expect(typeof api.HedgerowFetchError).toBe("function");
    expect(api.DEFAULT_APPVIEW).toBe("https://public.api.bsky.app");
    expect(api.POST_COLLECTION).toBe("app.bsky.feed.post");
    expect(api.NOT_FOUND_POST).toBe("app.bsky.feed.defs#notFoundPost");
    expect(api.BLOCKED_POST).toBe("app.bsky.feed.defs#blockedPost");
  });
});
