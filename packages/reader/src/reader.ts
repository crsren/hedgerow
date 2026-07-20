// The headless engine: an OAuth session plus the reads/writes the demo needs
// (getProfile, createReply), wired through two DI seams — createClient and
// createAgent — so tests never touch WebCrypto, IndexedDB, or the network.
import { createDefaultAgent, createDefaultClient } from "./default-client.js";
import type { AgentLike, OAuthClientLike, OAuthPrompt, OAuthSessionLike } from "./client-types.js";
import type { CreateReplyInput, Reader, ReaderProfile, ReaderSession, StrongRef } from "./types.js";

/** Default authorization server for `signUp()` — the same one `signIn()`'s
 * README example points a bare handle at when there's no PDS hint yet. */
const DEFAULT_SIGNUP_SERVICE = "https://bsky.social";

/** identity + generic record writes — createReply() needs the latter. Every
 * authorize request asks for exactly this, matching the scope embedded in
 * the client metadata (see default-client.ts's loopbackClientId and the
 * demo's client-metadata.json) — requesting more than the client is
 * registered for would be rejected server-side. */
const ATPROTO_SCOPE = "atproto transition:generic";

const LIKE_COLLECTION = "app.bsky.feed.like";
/** Actors per listRecords page (the endpoint's own max). */
const LIKE_PAGE_SIZE = 100;
/** Page cap for findLike's search — see the Reader.findLike doc comment for
 * exactly what this bounds and why it's an acceptable trade-off. */
const LIKE_MAX_PAGES = 10;

export interface CreateReaderOptions {
  /** Hosted `client-metadata.json` URL for a real deployment. Omit for loopback dev. */
  clientId?: string;
  /** URL of a service exposing `com.atproto.identity.resolveHandle`. Defaults to the public AppView. */
  handleResolver?: string;
  /** Override the PLC directory base. For local/test networks only — see `docs/local-testing.md`. */
  plcDirectoryUrl?: string;
  /** Allow `http://` authorization-server/resource metadata endpoints. For local/test networks only. */
  allowHttp?: boolean;
  /** Build the underlying OAuth client. Defaults to a real `BrowserOAuthClient`; override in tests. */
  createClient?(): OAuthClientLike | Promise<OAuthClientLike>;
  /** Build the Agent used for reads/writes from a session. Defaults to `new Agent(session)`; override in tests. */
  createAgent?(session: OAuthSessionLike): AgentLike;
}

async function fetchProfileFor(session: OAuthSessionLike, agent: AgentLike): Promise<ReaderProfile> {
  const { data } = await agent.getProfile({ actor: session.did });
  return { did: data.did, handle: data.handle, displayName: data.displayName, avatar: data.avatar };
}

export function createReader(options: CreateReaderOptions = {}): Reader {
  const buildClient =
    options.createClient ??
    (() =>
      createDefaultClient({
        clientId: options.clientId,
        handleResolver: options.handleResolver,
        plcDirectoryUrl: options.plcDirectoryUrl,
        allowHttp: options.allowHttp,
      }));
  const buildAgent = options.createAgent ?? createDefaultAgent;

  // The OAuth client itself is built lazily and at most once — constructing
  // BrowserOAuthClient touches IndexedDB, which a consumer may not want paid
  // for until the reader box is actually used.
  let clientPromise: Promise<OAuthClientLike> | null = null;
  const getClient = (): Promise<OAuthClientLike> => (clientPromise ??= Promise.resolve(buildClient()));

  let session: OAuthSessionLike | null = null;
  let agent: AgentLike | null = null;

  // findLike()/like() results, cached per session — see Reader.findLike's doc
  // comment. Keyed both directions so unlike(likeUri) (which doesn't know the
  // subject) can still invalidate the right entry.
  let likeBySubject = new Map<string, StrongRef | null>();
  let subjectByLikeUri = new Map<string, string>();
  // In-flight findLike lookups, deduped by subject uri — a comment thread can
  // mount several like buttons for the same subject (e.g. a rerender racing a
  // click) before the first lookup resolves; without this each would page the
  // whole listRecords search independently.
  let pendingLookups = new Map<string, Promise<StrongRef | null>>();

  function setSession(next: OAuthSessionLike | null): AgentLike | null {
    session = next;
    agent = next ? buildAgent(next) : null;
    likeBySubject = new Map();
    subjectByLikeUri = new Map();
    pendingLookups = new Map();
    return agent;
  }

  /** Page the reader's own app.bsky.feed.like collection for `subjectUri`, newest first. Bounded — see Reader.findLike. */
  async function searchOwnLikes(subjectUri: string): Promise<StrongRef | null> {
    let cursor: string | undefined;
    for (let page = 0; page < LIKE_MAX_PAGES; page++) {
      const { records, cursor: next } = await agent!.listOwnRecords({
        collection: LIKE_COLLECTION,
        limit: LIKE_PAGE_SIZE,
        reverse: true,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      for (const record of records) {
        const subject = (record.value as { subject?: { uri?: string } }).subject;
        if (subject?.uri === subjectUri) return { uri: record.uri, cid: record.cid };
      }
      if (!next || records.length === 0) return null;
      cursor = next;
    }
    return null;
  }

  /** findLike's engine — resolves the full {@link StrongRef}, not just the uri, so `like()` can reuse it without a second fetch. */
  function findLikeRef(subjectUri: string): Promise<StrongRef | null> {
    if (likeBySubject.has(subjectUri)) return Promise.resolve(likeBySubject.get(subjectUri)!);
    if (!agent) return Promise.resolve(null);

    const pending =
      pendingLookups.get(subjectUri) ??
      searchOwnLikes(subjectUri).finally(() => pendingLookups.delete(subjectUri));
    pendingLookups.set(subjectUri, pending);

    return pending.then((found) => {
      likeBySubject.set(subjectUri, found);
      if (found) subjectByLikeUri.set(found.uri, subjectUri);
      return found;
    });
  }

  // client.init() may only run once per client instance (restoring a session
  // AND completing a pending OAuth redirect are the same call); memoize so a
  // second `restore()` (React effects can double-fire) reuses this result
  // instead of re-running it.
  let restorePromise: Promise<ReaderSession | null> | null = null;

  // Shared by signIn/signUp: kick off an authorize redirect and never return
  // normally. The authorization server for this kind of client (a public
  // browser app) always shows a consent screen — it doesn't accept a silent
  // (`prompt: "none"`) request — so there's no silent variant to offer here.
  async function redirect(input: string, prompt?: OAuthPrompt): Promise<never> {
    const client = await getClient();
    await client.signIn(input, { scope: ATPROTO_SCOPE, ...(prompt ? { prompt } : {}) });
    throw new Error(`createReader: signIn() resolved without redirecting (input: ${input})`);
  }

  return {
    restore(): Promise<ReaderSession | null> {
      return (restorePromise ??= (async () => {
        const client = await getClient();
        const result = await client.init();
        if (!result) return null;
        const builtAgent = setSession(result.session)!;
        // The session itself is already good here (a real OAuth token) —
        // don't let a failed profile fetch (a separate, transient AppView
        // call: e.g. no AppView configured, as on a bare local test PDS, or
        // a momentary hiccup right after the OAuth redirect) collapse a
        // genuinely successful login back to "signed out". Fall back to the
        // did as a placeholder handle; a later getProfile() call can fill in
        // the real one once/if it succeeds.
        const profile = await fetchProfileFor(result.session, builtAgent).catch(
          (): ReaderProfile => ({ did: result.session.did, handle: result.session.did }),
        );
        return { did: profile.did, handle: profile.handle, displayName: profile.displayName };
      })());
    },

    signIn(handle: string): Promise<never> {
      return redirect(handle);
    },

    signUp(service: string = DEFAULT_SIGNUP_SERVICE): Promise<never> {
      // prompt: "create" is the one prompt value the provider's forced-consent
      // gate exempts for a public client — the reader creates their account on
      // `service` mid-flow and lands back already authorized.
      return redirect(service, "create");
    },

    async signOut(): Promise<void> {
      if (session) await session.signOut();
      setSession(null);
    },

    getProfile(): Promise<ReaderProfile | null> {
      return session && agent ? fetchProfileFor(session, agent) : Promise.resolve(null);
    },

    async createReply({ root, parent, text }: CreateReplyInput): Promise<StrongRef> {
      if (!agent) throw new Error("createReader: createReply() called while signed out");
      const { uri, cid } = await agent.post({
        $type: "app.bsky.feed.post",
        text,
        reply: { root, parent },
        createdAt: new Date().toISOString(),
      });
      return { uri, cid };
    },

    async like(subject: StrongRef): Promise<StrongRef> {
      if (!agent) throw new Error("createReader: like() called while signed out");
      // Check first — see the Reader.findLike doc comment for the bound this
      // dedup is subject to and why the residual risk of a duplicate is
      // accepted rather than engineered away entirely.
      const existing = await findLikeRef(subject.uri);
      if (existing) return existing;

      const { uri, cid } = await agent.like(subject.uri, subject.cid);
      const ref = { uri, cid };
      likeBySubject.set(subject.uri, ref);
      subjectByLikeUri.set(uri, subject.uri);
      return ref;
    },

    async unlike(likeUri: string): Promise<void> {
      if (!agent) throw new Error("createReader: unlike() called while signed out");
      await agent.deleteLike(likeUri);
      const subjectUri = subjectByLikeUri.get(likeUri);
      if (subjectUri) {
        likeBySubject.set(subjectUri, null);
        subjectByLikeUri.delete(likeUri);
      }
    },

    async findLike(subjectUri: string): Promise<string | null> {
      const ref = await findLikeRef(subjectUri);
      return ref?.uri ?? null;
    },
  };
}
