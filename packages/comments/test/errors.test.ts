import { describe, expect, it } from "vitest";
import { fetchThread } from "../src/thread.js";
import { xrpcGet } from "../src/xrpc.js";
import { HedgerowFetchError } from "../src/errors.js";
import { catchError, jsonResponse, stubFetch } from "./helpers.js";

const URI = "at://did:plc:x/app.bsky.feed.post/rkey";

describe("HedgerowFetchError typing", () => {
  it("parses an XRPC error body and flags NotFound", async () => {
    const stub = stubFetch(() =>
      jsonResponse({ error: "NotFound", message: "Post not found" }, 400),
    );
    const err = await catchError<HedgerowFetchError>(
      fetchThread(URI, { fetchImpl: stub.fetch, preResolved: true }),
    );
    expect(err).toBeInstanceOf(HedgerowFetchError);
    expect(err.status).toBe(400);
    expect(err.xrpcError).toBe("NotFound");
    expect(err.xrpcMessage).toBe("Post not found");
    expect(err.isNotFound).toBe(true);
    expect(err.network).toBe(false);
    expect(err.method).toBe("app.bsky.feed.getPostThread");
  });

  it("flags a 404 as isNotFound even without an XRPC body", async () => {
    const stub = stubFetch(() => new Response("nope", { status: 404 }));
    const err = await catchError<HedgerowFetchError>(
      xrpcGet(
      "https://x",
      "app.bsky.feed.getPostThread",
      { uri: URI },
      stub.fetch,
    ),
    );
    expect(err.isNotFound).toBe(true);
  });

  it("distinguishes a network failure (status 0, network true)", async () => {
    const stub = stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const err = await catchError<HedgerowFetchError>(
      xrpcGet(
      "https://x",
      "app.bsky.feed.getLikes",
      { uri: URI },
      stub.fetch,
    ),
    );
    expect(err).toBeInstanceOf(HedgerowFetchError);
    expect(err.status).toBe(0);
    expect(err.network).toBe(true);
    expect(err.isNotFound).toBe(false);
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it("carries a non-NotFound XRPC error without marking it NotFound", async () => {
    const stub = stubFetch(() =>
      jsonResponse({ error: "InvalidRequest", message: "bad uri" }, 400),
    );
    const err = await catchError<HedgerowFetchError>(
      xrpcGet(
      "https://x",
      "app.bsky.feed.getLikes",
      { uri: URI },
      stub.fetch,
    ),
    );
    expect(err.xrpcError).toBe("InvalidRequest");
    expect(err.isNotFound).toBe(false);
  });
});
