// The headless engine: an OAuth session plus the reads/writes the demo needs
// (getProfile, createReply), wired through two DI seams — createClient and
// createAgent — so tests never touch WebCrypto, IndexedDB, or the network.
import { createDefaultAgent, createDefaultClient } from "./default-client.js";
import type { AgentLike, OAuthClientLike, OAuthPrompt, OAuthSessionLike } from "./client-types.js";
import type {
  CreateReplyInput,
  PublisherLike,
  Reader,
  ReaderProfile,
  ReaderSession,
  StrongRef,
} from "./types.js";

/** Default authorization server for `signUp()` — the same one `signIn()`'s
 * README example points a bare handle at when there's no PDS hint yet. */
const DEFAULT_SIGNUP_SERVICE = "https://bsky.social";

/**
 * True only for the PDS's "this record does not exist" XRPC error (`error:
 * "RecordNotFound"`, message "Could not locate record: …"). Mirrors
 * `@hedgerow/publish`'s helper of the same name — duplicated, not imported,
 * per the no-dependency-between-reader-and-publish rule.
 */
function isRecordNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { error?: unknown; message?: unknown };
  return (
    e.error === "RecordNotFound" ||
    (typeof e.message === "string" && e.message.includes("Could not locate record"))
  );
}

/** identity + generic record writes — createReply() needs the latter. Every
 * authorize request asks for exactly this, matching the scope embedded in
 * the client metadata (see default-client.ts's loopbackClientId and the
 * demo's client-metadata.json) — requesting more than the client is
 * registered for would be rejected server-side. */
const ATPROTO_SCOPE = "atproto transition:generic";

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

  function setSession(next: OAuthSessionLike | null): AgentLike | null {
    session = next;
    agent = next ? buildAgent(next) : null;
    return agent;
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

    asPublisher(): PublisherLike {
      if (!session || !agent) {
        throw new Error("createReader: asPublisher() called while signed out");
      }
      const did = session.did;
      // Resolves the live `com.atproto.repo.*` surface off the OUTER `agent`
      // variable (never a copy captured at asPublisher() call time), so a
      // later signOut() correctly makes a Publisher built before it start
      // throwing too, rather than silently keeping a stale session alive.
      // `AgentLike.com` is optional (a minimal getProfile/post-only fake, as
      // several reader.test.ts cases use, doesn't need to stub it) — real
      // agents (createDefaultAgent's `new Agent(session)`) always have it.
      function repo() {
        if (!agent) throw new Error("createReader: asPublisher() used after sign-out");
        if (!agent.com) throw new Error("createReader: asPublisher() needs an agent with com.atproto.repo.*");
        return agent.com.atproto.repo;
      }
      return {
        did,
        async putRecord(collection, rkey, record) {
          const res = await repo().putRecord({ repo: did, collection, rkey, record });
          return { uri: res.data.uri, cid: res.data.cid };
        },
        async getRecord(collection, rkey) {
          try {
            const res = await repo().getRecord({ repo: did, collection, rkey });
            return res.data.value;
          } catch (err) {
            // Only "record doesn't exist" may become null — a transient
            // failure must propagate, or a caller that treats null as
            // "absent" (e.g. publishSite's anchor fallback) silently
            // destroys data it should have preserved.
            if (isRecordNotFound(err)) return null;
            throw err;
          }
        },
        async deleteRecord(collection, rkey) {
          await repo().deleteRecord({ repo: did, collection, rkey });
        },
      };
    },
  };
}
