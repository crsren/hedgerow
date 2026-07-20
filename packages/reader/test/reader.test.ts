// Coverage for the headless engine (`createReader`) via its two DI seams —
// `createClient` / `createAgent` — so nothing here ever touches WebCrypto,
// IndexedDB, or the network. The real `BrowserOAuthClient`/`Agent` wiring in
// default-client.ts is the browser dance: like publish's oauth.ts loopback
// login, it's exercised by hand (see the package README), not here.
import { describe, expect, it, vi } from "vitest";
import { createReader } from "../src/reader.js";
import type {
  AgentLike,
  ListOwnRecordsResult,
  OAuthClientLike,
  OAuthSessionLike,
  ProfileView,
  RecordListItem,
} from "../src/client-types.js";

const PROFILE: ProfileView = {
  did: "did:plc:reader",
  handle: "reader.bsky.social",
  displayName: "Reader Person",
  avatar: "https://example.com/avatar.jpg",
};

function fakeSession(did = PROFILE.did): OAuthSessionLike & { signOut: ReturnType<typeof vi.fn> } {
  return {
    did,
    fetchHandler: vi.fn(async () => new Response(null, { status: 200 })),
    signOut: vi.fn(async () => {}),
  };
}

/** `existingLikes` seeds what `listOwnRecords` (and therefore findLike) will page through. */
function fakeAgent(profile: ProfileView = PROFILE, existingLikes: RecordListItem[] = []) {
  const getProfile = vi.fn(async () => ({ data: profile }));
  const post = vi.fn(async (record: Record<string, unknown>) => ({
    uri: `at://${profile.did}/app.bsky.feed.post/reply1`,
    cid: "bafyreply1",
    record,
  }));
  let nextLikeRkey = 1;
  const like = vi.fn(async (uri: string, cid: string) => ({
    uri: `at://${profile.did}/app.bsky.feed.like/like${nextLikeRkey++}`,
    cid: `bafylike-for-${cid}`,
  }));
  const deleteLike = vi.fn(async (_likeUri: string) => {});
  const listOwnRecords = vi.fn(
    async ({ limit = 100, cursor }: { limit?: number; cursor?: string }): Promise<ListOwnRecordsResult> => {
      const start = cursor ? Number(cursor) : 0;
      const records = existingLikes.slice(start, start + limit);
      const nextCursor = start + limit < existingLikes.length ? String(start + limit) : undefined;
      return { records, ...(nextCursor ? { cursor: nextCursor } : {}) };
    },
  );
  return {
    agent: { getProfile, post, like, deleteLike, listOwnRecords } as unknown as AgentLike,
    getProfile,
    post,
    like,
    deleteLike,
    listOwnRecords,
  };
}

/** A client whose init() resolves a fresh session (as if a session existed already). */
function clientWithSession(session: OAuthSessionLike) {
  const init = vi.fn(async () => ({ session }));
  const signIn = vi.fn(async (): Promise<OAuthSessionLike> => session);
  return { client: { init, signIn } as OAuthClientLike, init, signIn };
}

/** A client with no restorable session and no pending callback. */
function clientWithoutSession() {
  const init = vi.fn(async () => undefined);
  const signIn = vi.fn(async (): Promise<OAuthSessionLike> => fakeSession());
  return { client: { init, signIn } as OAuthClientLike, init, signIn };
}

describe("createReader — restore", () => {
  it("returns null when there is no session to resume", async () => {
    const { client } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    expect(await reader.restore()).toBeNull();
  });

  it("resolves the session profile when a session is restored", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });

    const result = await reader.restore();
    expect(result).toEqual({ did: PROFILE.did, handle: PROFILE.handle, displayName: PROFILE.displayName });
  });

  it("still resolves a session (falling back to the did as handle) when the profile fetch fails", async () => {
    // The session token itself is valid (a real OAuth login) — a getProfile
    // failure is a separate, transient concern (e.g. no AppView to proxy to,
    // as on a bare local test PDS) and must not make restore() look like the
    // login itself failed.
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const agent: AgentLike = {
      getProfile: vi.fn(async () => {
        throw new Error("502 Bad Gateway");
      }),
      post: vi.fn(),
      like: vi.fn(),
      deleteLike: vi.fn(),
      listOwnRecords: vi.fn(),
    };
    const reader = createReader({ createClient: () => client, createAgent: () => agent });

    const result = await reader.restore();
    expect(result).toEqual({ did: session.did, handle: session.did });
  });

  it("runs the client's one-time init() only once across repeated restore() calls", async () => {
    const session = fakeSession();
    const { client, init } = clientWithSession(session);
    const { agent } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });

    await Promise.all([reader.restore(), reader.restore(), reader.restore()]);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("builds the OAuth client itself at most once, lazily", async () => {
    const { client } = clientWithoutSession();
    const createClient = vi.fn(() => client);
    const reader = createReader({ createClient });

    expect(createClient).not.toHaveBeenCalled(); // not built until first use
    await reader.restore();
    await reader.getProfile();
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe("createReader — signIn", () => {
  it("calls the client's signIn with the given handle and throws if it ever resolves", async () => {
    const { client, signIn } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    await expect(reader.signIn("chris.bsky.social")).rejects.toThrow(/resolved without redirecting/);
    expect(signIn).toHaveBeenCalledWith("chris.bsky.social", { scope: "atproto transition:generic" });
  });

  it("propagates an abort/rejection from the client's signIn", async () => {
    const abortError = new Error("aborted");
    const client: OAuthClientLike = {
      init: vi.fn(async () => undefined),
      signIn: vi.fn(async () => {
        throw abortError;
      }),
    };
    const reader = createReader({ createClient: () => client });

    await expect(reader.signIn("chris.bsky.social")).rejects.toBe(abortError);
  });
});

describe("createReader — signUp", () => {
  it("redirects to the default service (bsky.social) with prompt: create", async () => {
    const { client, signIn } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    await expect(reader.signUp()).rejects.toThrow(/resolved without redirecting/);
    expect(signIn).toHaveBeenCalledWith("https://bsky.social", {
      scope: "atproto transition:generic",
      prompt: "create",
    });
  });

  it("redirects to a custom service when given one", async () => {
    const { client, signIn } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    await expect(reader.signUp("https://example-pds.test")).rejects.toThrow(/resolved without redirecting/);
    expect(signIn).toHaveBeenCalledWith("https://example-pds.test", {
      scope: "atproto transition:generic",
      prompt: "create",
    });
  });

  it("propagates an abort/rejection from the client's signIn", async () => {
    const abortError = new Error("aborted");
    const client: OAuthClientLike = {
      init: vi.fn(async () => undefined),
      signIn: vi.fn(async () => {
        throw abortError;
      }),
    };
    const reader = createReader({ createClient: () => client });

    await expect(reader.signUp()).rejects.toBe(abortError);
  });
});

describe("createReader — signOut", () => {
  it("clears the session and calls the underlying session.signOut()", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });

    await reader.restore();
    expect(await reader.getProfile()).not.toBeNull();

    await reader.signOut();
    expect(session.signOut).toHaveBeenCalledTimes(1);
    expect(await reader.getProfile()).toBeNull();
  });

  it("is a no-op when there is no active session", async () => {
    const { client } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    await expect(reader.signOut()).resolves.toBeUndefined();
  });
});

describe("createReader — getProfile", () => {
  it("returns null before any session is restored", async () => {
    const { client } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    expect(await reader.getProfile()).toBeNull();
  });

  it("fetches the full profile (did, handle, displayName, avatar) once signed in", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, getProfile } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });

    await reader.restore();
    const profile = await reader.getProfile();

    expect(profile).toEqual(PROFILE);
    expect(getProfile).toHaveBeenCalledWith({ actor: PROFILE.did });
  });
});

describe("createReader — createReply", () => {
  it("throws when called while signed out", async () => {
    const { client } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    await expect(
      reader.createReply({
        root: { uri: "at://did:plc:root/app.bsky.feed.post/root1", cid: "bafyroot" },
        parent: { uri: "at://did:plc:root/app.bsky.feed.post/root1", cid: "bafyroot" },
        text: "hello",
      }),
    ).rejects.toThrow(/signed out/);
  });

  it("builds an app.bsky.feed.post record with the reply refs preserved", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, post } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    const root = { uri: "at://did:plc:root/app.bsky.feed.post/root1", cid: "bafyroot" };
    const parent = { uri: "at://did:plc:root/app.bsky.feed.post/parent1", cid: "bafyparent" };
    const result = await reader.createReply({ root, parent, text: "Great post!" });

    expect(post).toHaveBeenCalledTimes(1);
    const record = post.mock.calls[0]![0];
    expect(record).toMatchObject({
      $type: "app.bsky.feed.post",
      text: "Great post!",
      reply: { root, parent },
    });
    expect(typeof record.createdAt).toBe("string");
    expect(() => new Date(record.createdAt as string).toISOString()).not.toThrow();
    // rkey is left to the server (com.atproto.repo.createRecord via Agent.post) — no rkey on the record itself.
    expect(record).not.toHaveProperty("rkey");

    expect(result).toEqual({ uri: `at://${PROFILE.did}/app.bsky.feed.post/reply1`, cid: "bafyreply1" });
  });
});

const SUBJECT = { uri: "at://did:plc:root/app.bsky.feed.post/root1", cid: "bafyroot" };

describe("createReader — like", () => {
  it("throws when called while signed out", async () => {
    const { client } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    await expect(reader.like(SUBJECT)).rejects.toThrow(/signed out/);
  });

  it("checks findLike first, then writes a new like when none exists", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, like, listOwnRecords } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    const result = await reader.like(SUBJECT);

    expect(listOwnRecords).toHaveBeenCalled(); // the findLike-before-creating dedup check
    expect(like).toHaveBeenCalledWith(SUBJECT.uri, SUBJECT.cid);
    expect(result.uri).toContain("app.bsky.feed.like");
  });

  it("does not write a duplicate when the subject is already liked (dedup mitigation)", async () => {
    const existingLikeUri = `at://${PROFILE.did}/app.bsky.feed.like/existing1`;
    const existing: RecordListItem = {
      uri: existingLikeUri,
      cid: "bafyexisting",
      value: { subject: SUBJECT, createdAt: new Date().toISOString() },
    };
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, like } = fakeAgent(PROFILE, [existing]);
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    const result = await reader.like(SUBJECT);

    expect(like).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: existingLikeUri, cid: "bafyexisting" });
  });

  it("caches a like() write so a later findLike for the same subject is free", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, listOwnRecords } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    const written = await reader.like(SUBJECT);
    listOwnRecords.mockClear();
    const found = await reader.findLike(SUBJECT.uri);

    expect(found).toBe(written.uri);
    expect(listOwnRecords).not.toHaveBeenCalled();
  });
});

describe("createReader — unlike", () => {
  it("throws when called while signed out", async () => {
    const { client } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    await expect(reader.unlike("at://did:plc:reader/app.bsky.feed.like/x")).rejects.toThrow(/signed out/);
  });

  it("deletes the like record and invalidates the cache for its subject", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, deleteLike, listOwnRecords } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    const written = await reader.like(SUBJECT);
    await reader.unlike(written.uri);

    expect(deleteLike).toHaveBeenCalledWith(written.uri);

    listOwnRecords.mockClear();
    const found = await reader.findLike(SUBJECT.uri);
    // The cache now correctly says "not liked" — a cache HIT (no re-page
    // needed), not a stale "still liked" answer left over from before unlike.
    expect(found).toBeNull();
    expect(listOwnRecords).not.toHaveBeenCalled();
  });
});

describe("createReader — findLike", () => {
  it("returns null while signed out, without paging anything", async () => {
    const { client } = clientWithoutSession();
    const reader = createReader({ createClient: () => client });

    expect(await reader.findLike(SUBJECT.uri)).toBeNull();
  });

  it("returns null when the reader has no like for the subject", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    expect(await reader.findLike(SUBJECT.uri)).toBeNull();
  });

  it("finds an existing like by paging listOwnRecords, newest first", async () => {
    const existing: RecordListItem = {
      uri: `at://${PROFILE.did}/app.bsky.feed.like/found1`,
      cid: "bafyfound",
      value: { subject: SUBJECT, createdAt: new Date().toISOString() },
    };
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, listOwnRecords } = fakeAgent(PROFILE, [existing]);
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    const found = await reader.findLike(SUBJECT.uri);

    expect(found).toBe(existing.uri);
    expect(listOwnRecords.mock.calls[0]![0]).toMatchObject({ collection: "app.bsky.feed.like", reverse: true });
  });

  it("pages up to the bound (~10 pages) before giving up, never past it", async () => {
    // 10 full pages of 100 unrelated likes = right at the bound; the wanted
    // subject is never in there, so this proves the search actually stops
    // rather than paging forever.
    const noise: RecordListItem[] = Array.from({ length: 1000 }, (_, i) => ({
      uri: `at://${PROFILE.did}/app.bsky.feed.like/noise${i}`,
      cid: `bafynoise${i}`,
      value: { subject: { uri: `at://did:plc:other/app.bsky.feed.post/${i}`, cid: "bafyx" }, createdAt: "" },
    }));
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, listOwnRecords } = fakeAgent(PROFILE, noise);
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    const found = await reader.findLike(SUBJECT.uri);

    expect(found).toBeNull();
    expect(listOwnRecords).toHaveBeenCalledTimes(10); // the documented page cap
  });

  it("caches the result — a second call for the same subject does not re-page", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, listOwnRecords } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    await reader.findLike(SUBJECT.uri);
    const callsAfterFirst = listOwnRecords.mock.calls.length;
    await reader.findLike(SUBJECT.uri);

    expect(listOwnRecords.mock.calls.length).toBe(callsAfterFirst);
  });

  it("dedupes concurrent lookups for the same subject into one search", async () => {
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, listOwnRecords } = fakeAgent();
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    await Promise.all([reader.findLike(SUBJECT.uri), reader.findLike(SUBJECT.uri), reader.findLike(SUBJECT.uri)]);

    expect(listOwnRecords).toHaveBeenCalledTimes(1);
  });

  it("clears the like cache and agent on sign-out — no stale cached hit survives it", async () => {
    const existing: RecordListItem = {
      uri: `at://${PROFILE.did}/app.bsky.feed.like/found1`,
      cid: "bafyfound",
      value: { subject: SUBJECT, createdAt: new Date().toISOString() },
    };
    const session = fakeSession();
    const { client } = clientWithSession(session);
    const { agent, listOwnRecords } = fakeAgent(PROFILE, [existing]);
    const reader = createReader({ createClient: () => client, createAgent: () => agent });
    await reader.restore();

    expect(await reader.findLike(SUBJECT.uri)).toBe(existing.uri); // populates the cache while signed in

    await reader.signOut();
    listOwnRecords.mockClear();

    // Signed out: null, and not served from the pre-signout cache (which
    // would otherwise happily keep answering "liked" for a session that no
    // longer exists).
    expect(await reader.findLike(SUBJECT.uri)).toBeNull();
    expect(listOwnRecords).not.toHaveBeenCalled(); // no agent to even ask
  });
});
