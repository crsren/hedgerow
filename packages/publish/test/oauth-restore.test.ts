// Coverage for oauthPublisher's session-RESTORE path (the non-browser branch):
// with a cached session on disk, it restores rather than launching the loopback
// login. We stub NodeOAuthClient (so restore() returns a fake OAuth session with
// no network), Agent (so agentPublisher just reads `.did`), and resolveDid (the
// handle→did lookup restoreSession does). The actual browser dance in
// loginSession is deliberately left to the manual test in the README.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileStore } from "../src/store.js";

const restore = vi.fn();
const authorize = vi.fn();
const callback = vi.fn();

vi.mock("@atproto/oauth-client-node", async (importActual) => ({
  ...(await importActual<typeof import("@atproto/oauth-client-node")>()),
  // Replace only the client; keep the real client-metadata builder + lock.
  NodeOAuthClient: class {
    restore = restore;
    authorize = authorize;
    callback = callback;
  },
}));

vi.mock("@atproto/api", () => ({
  // agentPublisher only reads `.did`; the repo methods are never called here.
  Agent: class {
    did: string;
    com = { atproto: { repo: {} } };
    constructor(session: { did: string }) {
      this.did = session.did;
    }
  },
}));

const resolveDid = vi.fn();
vi.mock("../src/read.js", () => ({ resolveDid }));

const { oauthPublisher, clearSession } = await import("../src/oauth.js");

const SESSION_FILE = "oauth-session.json";

describe("oauthPublisher — restoring a cached session", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hedgerow-restore-"));
    restore.mockReset();
    authorize.mockReset();
    resolveDid.mockReset();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Seed one or more cached sessions keyed by did. */
  function seedSessions(...dids: string[]) {
    const store = new FileStore<{ token: string }>(join(dir, SESSION_FILE));
    for (const did of dids) store.set(did, { token: "cached" });
  }

  it("restores by explicit did without any browser login or handle lookup", async () => {
    seedSessions("did:plc:me", "did:plc:other");
    restore.mockResolvedValue({ did: "did:plc:me" });
    const openUrl = vi.fn();

    const pub = await oauthPublisher({ store: dir, identifier: "did:plc:me", openUrl });

    expect(pub.did).toBe("did:plc:me");
    expect(restore).toHaveBeenCalledWith("did:plc:me");
    expect(resolveDid).not.toHaveBeenCalled(); // did short-circuits resolution
    expect(openUrl).not.toHaveBeenCalled(); // restore path never opens a browser
    expect(authorize).not.toHaveBeenCalled();
  });

  it("restores the sole cached session when no identifier is given", async () => {
    seedSessions("did:plc:solo");
    restore.mockResolvedValue({ did: "did:plc:solo" });

    const pub = await oauthPublisher({ store: dir });

    expect(pub.did).toBe("did:plc:solo");
    expect(restore).toHaveBeenCalledWith("did:plc:solo");
  });

  it("resolves a handle identifier to its cached did before restoring", async () => {
    seedSessions("did:plc:me");
    resolveDid.mockResolvedValue("did:plc:me");
    restore.mockResolvedValue({ did: "did:plc:me" });

    const pub = await oauthPublisher({ store: dir, identifier: "chris.test" });

    expect(resolveDid).toHaveBeenCalledWith("chris.test");
    expect(restore).toHaveBeenCalledWith("did:plc:me");
    expect(pub.did).toBe("did:plc:me");
  });

  it("clearSession resolves a handle to its did before deleting that session", async () => {
    seedSessions("did:plc:me", "did:plc:other");
    resolveDid.mockResolvedValue("did:plc:me");

    await clearSession({ store: dir, identifier: "chris.test" });

    expect(resolveDid).toHaveBeenCalledWith("chris.test");
    // only the resolved did was removed
    expect(new FileStore(join(dir, SESSION_FILE)).keys()).toEqual(["did:plc:other"]);
  });
});
