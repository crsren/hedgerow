// The headless engine: an OAuth session plus the reads/writes the demo needs
// (getProfile, createReply), wired through two DI seams — createClient and
// createAgent — so tests never touch WebCrypto, IndexedDB, or the network.
import { createDefaultAgent, createDefaultClient } from "./default-client.js";
import type { AgentLike, OAuthClientLike, OAuthPrompt, OAuthSessionLike } from "./client-types.js";
import type { CreateReplyInput, Reader, ReaderProfile, ReaderSession, StrongRef } from "./types.js";

/** Default authorization server for `signUp()` — the same one `signIn()`'s
 * README example points a bare handle at when there's no PDS hint yet. */
const DEFAULT_SIGNUP_SERVICE = "https://bsky.social";

export interface CreateReaderOptions {
  /** Hosted `client-metadata.json` URL for a real deployment. Omit for loopback dev. */
  clientId?: string;
  /** URL of a service exposing `com.atproto.identity.resolveHandle`. Defaults to the public AppView. */
  handleResolver?: string;
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
    (() => createDefaultClient({ clientId: options.clientId, handleResolver: options.handleResolver }));
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
  // `prompt` is only forwarded when set, so a plain signIn() call matches the
  // library's own single-argument `signIn(input)` shape exactly.
  async function redirect(input: string, prompt?: OAuthPrompt): Promise<never> {
    const client = await getClient();
    await (prompt ? client.signIn(input, { prompt }) : client.signIn(input));
    throw new Error(`createReader: signIn() resolved without redirecting (input: ${input})`);
  }

  return {
    restore(): Promise<ReaderSession | null> {
      return (restorePromise ??= (async () => {
        const client = await getClient();
        const result = await client.init();
        if (!result) return null;
        const builtAgent = setSession(result.session)!;
        const profile = await fetchProfileFor(result.session, builtAgent);
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
  };
}
