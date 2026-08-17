import { createDefaultAgent, createDefaultClient } from "./default-client.js";
import type {
  AgentLike,
  OAuthClientLike,
  OAuthPrompt,
  OAuthSessionLike,
} from "./client-types.js";
import { IDENTITY_SCOPE } from "./scopes.js";
import type { PublisherLike, ReaderProfile } from "./types.js";

const DEFAULT_SIGNUP_SERVICE = "https://bsky.social";
const SESSION_CONTEXT = Symbol.for("pub.hedgerow.browser.session-context");

interface SessionContext {
  active: boolean;
  oauth: OAuthSessionLike;
  agent: AgentLike;
}

interface InternalBrowserSession extends BrowserSession {
  readonly [SESSION_CONTEXT]: SessionContext;
}

export interface BrowserSession {
  readonly did: string;
  readonly handle: string;
  readonly displayName?: string;
  /** Permission string actually returned with the token, when available. */
  readonly scope: string;
}

export interface CreateBrowserOptions {
  /** Hosted client-metadata URL. Omit only for loopback development. */
  clientId?: string;
  /** Default permission request. Identity-only unless a feature supplies more. */
  scope?: string;
  handleResolver?: string;
  plcDirectoryUrl?: string;
  allowHttp?: boolean;
  createClient?(): OAuthClientLike | Promise<OAuthClientLike>;
  createAgent?(session: OAuthSessionLike): AgentLike;
}

export interface BrowserAuthorizationOptions {
  state?: string;
  /** A subset of the maximum scope declared by the client metadata. */
  scope?: string;
}

export interface BrowserAuth {
  restore(): Promise<BrowserSession | null>;
  signIn(handle: string, options?: BrowserAuthorizationOptions): Promise<never>;
  signUp(service?: string, options?: BrowserAuthorizationOptions): Promise<never>;
  signOut(): Promise<void>;
  getProfile(): Promise<ReaderProfile | null>;
  takeCallbackState(): string | null;
}

function contextFor(session: BrowserSession): SessionContext {
  const context = (session as Partial<InternalBrowserSession>)[SESSION_CONTEXT];
  if (!context) throw new Error("BrowserSession was not created by Hedgerow");
  if (!context.active) throw new Error("BrowserSession was used after sign-out");
  return context;
}

/** Advanced plumbing for Hedgerow feature adapters; applications should not need it. */
export function browserSessionAgent(session: BrowserSession): AgentLike {
  return contextFor(session).agent;
}

function isRecordNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { error?: unknown; message?: unknown };
  return (
    value.error === "RecordNotFound" ||
    (typeof value.message === "string" &&
      value.message.includes("Could not locate record"))
  );
}

/** Advanced compatibility adapter. Curated APIs bind this to safe feature operations. */
export function publisherForSession(session: BrowserSession): PublisherLike {
  const did = session.did;
  function repo() {
    const agent = contextFor(session).agent;
    if (!agent.com) throw new Error("BrowserSession needs com.atproto.repo.* access");
    return agent.com.atproto.repo;
  }
  return {
    did,
    supportsSwapRecord: true,
    async putRecord(collection, rkey, record, options) {
      const response = await repo().putRecord({
        repo: did,
        collection,
        rkey,
        record,
        ...(options && "swapRecord" in options
          ? { swapRecord: options.swapRecord }
          : {}),
      });
      return { uri: response.data.uri, cid: response.data.cid };
    },
    async getRecord(collection, rkey) {
      try {
        const response = await repo().getRecord({ repo: did, collection, rkey });
        return response.data.value;
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    },
    async getRecordWithCid(collection, rkey) {
      try {
        const response = await repo().getRecord({ repo: did, collection, rkey });
        if (!response.data.cid) {
          throw new Error(
            `getRecord returned no cid: at://${did}/${collection}/${rkey}`,
          );
        }
        return {
          uri: response.data.uri,
          cid: response.data.cid,
          value: response.data.value,
        };
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    },
    async deleteRecord(collection, rkey, options) {
      await repo().deleteRecord({
        repo: did,
        collection,
        rkey,
        ...(options?.swapRecord ? { swapRecord: options.swapRecord } : {}),
      });
    },
  };
}

async function profileFor(
  oauth: OAuthSessionLike,
  agent: AgentLike,
): Promise<ReaderProfile> {
  const { data } = await agent.getProfile({ actor: oauth.did });
  return {
    did: data.did,
    handle: data.handle,
    displayName: data.displayName,
    avatar: data.avatar,
  };
}

export function createBrowser(options: CreateBrowserOptions = {}): BrowserAuth {
  const defaultScope = options.scope ?? IDENTITY_SCOPE;
  const buildClient =
    options.createClient ??
    (() =>
      createDefaultClient({
        clientId: options.clientId,
        scope: defaultScope,
        handleResolver: options.handleResolver,
        plcDirectoryUrl: options.plcDirectoryUrl,
        allowHttp: options.allowHttp,
      }));
  const buildAgent = options.createAgent ?? createDefaultAgent;

  let clientPromise: Promise<OAuthClientLike> | null = null;
  const getClient = (): Promise<OAuthClientLike> =>
    (clientPromise ??= Promise.resolve(buildClient()));
  let session: InternalBrowserSession | null = null;
  let restorePromise: Promise<BrowserSession | null> | null = null;
  let callbackState: string | null = null;

  async function redirect(
    input: string,
    prompt?: OAuthPrompt,
    options?: BrowserAuthorizationOptions,
  ): Promise<never> {
    const client = await getClient();
    await client.signIn(input, {
      scope: options?.scope ?? defaultScope,
      ...(prompt ? { prompt } : {}),
      ...(options?.state !== undefined ? { state: options.state } : {}),
    });
    throw new Error(`createBrowser: signIn() resolved without redirecting (input: ${input})`);
  }

  return {
    restore() {
      return (restorePromise ??= (async () => {
        const result = await (await getClient()).init();
        if (!result) return null;
        callbackState = result.state ?? null;
        const agent = buildAgent(result.session);
        const profile = await profileFor(result.session, agent).catch(
          (): ReaderProfile => ({
            did: result.session.did,
            handle: result.session.did,
          }),
        );
        const tokenScope = await result.session
          .getTokenInfo?.()
          .then((info) => info.scope)
          .catch(() => undefined);
        const context: SessionContext = {
          active: true,
          oauth: result.session,
          agent,
        };
        session = Object.freeze(
          Object.defineProperty(
            {
              // The OAuth subject is the authority for identity. Profile data
              // is presentation only and cannot retarget repository writes.
              did: result.session.did,
              handle: profile.handle,
              displayName: profile.displayName,
              scope: tokenScope ?? defaultScope,
            },
            SESSION_CONTEXT,
            { value: context },
          ),
        ) as InternalBrowserSession;
        return session;
      })());
    },
    signIn(handle, authorizationOptions) {
      return redirect(handle, undefined, authorizationOptions);
    },
    signUp(service = DEFAULT_SIGNUP_SERVICE, authorizationOptions) {
      return redirect(service, "create", authorizationOptions);
    },
    async signOut() {
      if (!session) return;
      const context = contextFor(session);
      try {
        await context.oauth.signOut();
      } finally {
        context.active = false;
        session = null;
        callbackState = null;
        // BrowserOAuthClient.init() is one-shot. A new authorization reloads
        // the page, so this instance must remain signed out after revocation.
        restorePromise = Promise.resolve(null);
      }
    },
    getProfile() {
      if (!session) return Promise.resolve(null);
      const context = contextFor(session);
      return profileFor(context.oauth, context.agent);
    },
    takeCallbackState() {
      const state = callbackState;
      callbackState = null;
      return state;
    },
  };
}
