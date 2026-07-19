// Unit coverage for the OAuth publish path — everything except the browser
// dance, which is manual (see the README testing section). We cover: the
// file-backed store round-trip, the Publisher adapter over a fake OAuth-session
// Agent, and the pure loopback client-metadata construction.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@atproto/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentPublisher } from "../src/auth.js";
import { loopbackClientMetadata, loopbackRedirectUri } from "../src/oauth.js";
import { FileStore } from "../src/store.js";

describe("FileStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hedgerow-store-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists and restores across instances (survives a reload)", () => {
    const path = join(dir, "sessions.json");
    const a = new FileStore<{ token: string }>(path);
    a.set("did:plc:abc", { token: "one" });
    a.set("did:plc:def", { token: "two" });

    // A fresh instance reads what the first one flushed to disk.
    const b = new FileStore<{ token: string }>(path);
    expect(b.get("did:plc:abc")).toEqual({ token: "one" });
    expect(b.get("did:plc:def")).toEqual({ token: "two" });
    expect(new Set(b.keys())).toEqual(new Set(["did:plc:abc", "did:plc:def"]));
  });

  it("deletes a single key and clears all", () => {
    const path = join(dir, "sessions.json");
    const store = new FileStore<number>(path);
    store.set("a", 1);
    store.set("b", 2);

    store.del("a");
    expect(store.get("a")).toBeUndefined();
    expect(new FileStore<number>(path).get("b")).toBe(2);

    store.clear();
    expect(store.keys()).toEqual([]);
    expect(new FileStore<number>(path).keys()).toEqual([]);
  });

  it("returns undefined for a missing key and an absent file", () => {
    expect(new FileStore(join(dir, "does-not-exist.json")).get("x")).toBeUndefined();
  });

  it("treats a corrupt store file as empty", () => {
    const path = join(dir, "corrupt.json");
    // Seed a broken file, then confirm we recover rather than throw.
    const seed = new FileStore<number>(path);
    seed.set("a", 1);
    writeFileSync(path, "{ not json");
    expect(new FileStore<number>(path).keys()).toEqual([]);
  });
});

describe("agentPublisher over an OAuth-session Agent", () => {
  // A stub shaped like the OAuth-session `Agent`: a `.did` plus the three
  // com.atproto.repo methods the adapter uses. Records the calls it receives.
  function fakeAgent(did: string | undefined) {
    const calls: { method: string; params: unknown }[] = [];
    const store = new Map<string, Record<string, unknown>>();
    const agent = {
      did,
      com: {
        atproto: {
          repo: {
            async putRecord(params: { collection: string; rkey: string; record: unknown }) {
              calls.push({ method: "putRecord", params });
              store.set(`${params.collection}/${params.rkey}`, params.record as Record<string, unknown>);
              return { data: { uri: `at://${did}/${params.collection}/${params.rkey}`, cid: "cid-123" } };
            },
            async getRecord(params: { collection: string; rkey: string }) {
              calls.push({ method: "getRecord", params });
              const value = store.get(`${params.collection}/${params.rkey}`);
              if (!value) throw new Error("RecordNotFound");
              return { data: { value } };
            },
            async deleteRecord(params: { collection: string; rkey: string }) {
              calls.push({ method: "deleteRecord", params });
              store.delete(`${params.collection}/${params.rkey}`);
            },
          },
        },
      },
    };
    return { agent: agent as unknown as Agent, calls };
  }

  it("exposes the agent's did", () => {
    const { agent } = fakeAgent("did:plc:me");
    expect(agentPublisher(agent).did).toBe("did:plc:me");
  });

  it("throws when the agent has no session (no did)", () => {
    const { agent } = fakeAgent(undefined);
    expect(() => agentPublisher(agent)).toThrow(/no active session/);
  });

  it("round-trips put/get/delete through com.atproto.repo, scoped to the did", async () => {
    const { agent, calls } = fakeAgent("did:plc:me");
    const pub = agentPublisher(agent);

    const put = await pub.putRecord("site.standard.document", "rk1", { title: "Hi" });
    expect(put).toEqual({ uri: "at://did:plc:me/site.standard.document/rk1", cid: "cid-123" });

    expect(await pub.getRecord("site.standard.document", "rk1")).toEqual({ title: "Hi" });

    await pub.deleteRecord("site.standard.document", "rk1");
    // getRecord swallows RecordNotFound and returns null (so publishSite re-puts).
    expect(await pub.getRecord("site.standard.document", "rk1")).toBeNull();

    // every repo call was addressed to the agent's own repo (did)
    const repos = calls.map((c) => (c.params as { repo?: string }).repo);
    expect(new Set(repos)).toEqual(new Set(["did:plc:me"]));
  });
});

describe("loopbackClientMetadata", () => {
  it("builds a native loopback client id encoding the scope and redirect", () => {
    const md = loopbackClientMetadata(4139);
    // The atproto loopback contract: client_id is http://localhost with the
    // scope + redirect_uri as query params; no client secret, native app.
    expect(md.client_id.startsWith("http://localhost?")).toBe(true);
    const params = new URL(md.client_id).searchParams;
    expect(params.get("scope")).toBe("atproto transition:generic");
    expect(params.get("redirect_uri")).toBe(loopbackRedirectUri(4139));

    expect(md.redirect_uris).toEqual(["http://127.0.0.1:4139/callback"]);
    expect(md.scope).toBe("atproto transition:generic");
    expect(md.token_endpoint_auth_method).toBe("none");
    expect(md.application_type).toBe("native");
    expect(md.response_types).toEqual(["code"]);
  });

  it("reflects a custom port in both the client id and redirect_uris", () => {
    const md = loopbackClientMetadata(5555);
    expect(md.redirect_uris).toEqual(["http://127.0.0.1:5555/callback"]);
    expect(new URL(md.client_id).searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:5555/callback",
    );
  });
});
