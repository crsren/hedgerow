import { describe, expect, it, vi } from "vitest";
import {
  browserSessionAgent,
  createBrowser,
  publisherForSession,
} from "../src/browser.js";
import type {
  AgentLike,
  OAuthClientLike,
  OAuthSessionLike,
} from "../src/client-types.js";
import { IDENTITY_SCOPE, SOCIAL_SCOPE } from "../src/scopes.js";

const DID = "did:plc:browser";

function fixtures(grantedScope = SOCIAL_SCOPE) {
  const session: OAuthSessionLike = {
    did: DID,
    fetchHandler: vi.fn(async () => new Response()),
    signOut: vi.fn(async () => {}),
    getTokenInfo: vi.fn(async () => ({ scope: grantedScope })),
  };
  const signIn = vi.fn(async () => session);
  const client: OAuthClientLike = {
    init: vi.fn(async () => ({ session })),
    signIn,
  };
  const agent: AgentLike = {
    getProfile: vi.fn(async () => ({
      data: { did: DID, handle: "browser.test", displayName: "Browser" },
    })),
    post: vi.fn(),
    like: vi.fn(),
    deleteLike: vi.fn(),
    listOwnRecords: vi.fn(),
    com: {
      atproto: {
        repo: {
          putRecord: vi.fn(async ({ collection, rkey }) => ({
            data: { uri: `at://${DID}/${collection}/${rkey}`, cid: "cid-new" },
          })),
          getRecord: vi.fn(async ({ collection, rkey }) => ({
            data: {
              uri: `at://${DID}/${collection}/${rkey}`,
              cid: "cid-old",
              value: { title: "Old" },
            },
          })),
          deleteRecord: vi.fn(async () => ({})),
        },
      },
    },
  };
  return { session, signIn, client, agent };
}

describe("createBrowser", () => {
  it("defaults authorization to identity-only", async () => {
    const { client, signIn, agent } = fixtures();
    const browser = createBrowser({
      createClient: () => client,
      createAgent: () => agent,
    });

    await expect(browser.signIn("browser.test")).rejects.toThrow(
      /resolved without redirecting/,
    );
    expect(signIn).toHaveBeenCalledWith("browser.test", {
      scope: IDENTITY_SCOPE,
    });
  });

  it("reports the permission scope returned with the restored token", async () => {
    const { client, agent } = fixtures(SOCIAL_SCOPE);
    const browser = createBrowser({
      createClient: () => client,
      createAgent: () => agent,
    });

    const restored = await browser.restore();

    expect(restored).toMatchObject({
      did: DID,
      handle: "browser.test",
      scope: SOCIAL_SCOPE,
    });
    expect(browserSessionAgent(restored!)).toBe(agent);
  });

  it("uses the OAuth subject as immutable session identity", async () => {
    const { client, agent } = fixtures();
    vi.mocked(agent.getProfile).mockResolvedValueOnce({
      data: { did: "did:plc:not-the-session", handle: "browser.test" },
    });
    const browser = createBrowser({
      createClient: () => client,
      createAgent: () => agent,
    });

    const restored = await browser.restore();

    expect(restored?.did).toBe(DID);
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it("invalidates feature transports when the browser session signs out", async () => {
    const { client, agent, session } = fixtures();
    const browser = createBrowser({
      createClient: () => client,
      createAgent: () => agent,
    });
    const restored = await browser.restore();
    const publisher = publisherForSession(restored!);

    await browser.signOut();

    expect(session.signOut).toHaveBeenCalledOnce();
    await expect(browser.restore()).resolves.toBeNull();
    await expect(
      publisher.getRecord("site.standard.document", "3mdocument"),
    ).rejects.toThrow(/after sign-out/);
  });
});
