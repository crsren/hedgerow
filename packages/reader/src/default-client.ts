// The real atproto wiring: builds an actual BrowserOAuthClient / Agent. The
// only module in this package that imports @atproto/oauth-client-browser
// (WebCrypto + IndexedDB) and @atproto/api — kept separate so unit tests can
// inject a fake client/agent (createReader's `createClient`/`createAgent`
// options) without ever loading either.
import { Agent } from "@atproto/api";
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import type { AgentLike, OAuthClientLike, OAuthSessionLike } from "./client-types.js";

/**
 * Bluesky's public AppView — the default handle resolver, the same host
 * `@hedgerow/comments` reads from. Resolving a handle here tells Bluesky the
 * handle and the caller's IP; pass your own `handleResolver` (e.g. your own
 * PDS, if you self-host one) to avoid that. See the package README.
 */
export const DEFAULT_HANDLE_RESOLVER = "https://public.api.bsky.app";

export interface DefaultClientOptions {
  /**
   * URL of a hosted `client-metadata.json`, required for a real deployment.
   * Omit for local dev on a loopback origin (127.0.0.1 / [::1]): the client
   * then derives the atproto loopback client id from `window.location`.
   */
  clientId?: string;
  handleResolver?: string;
}

/**
 * Build the real `BrowserOAuthClient`. With `clientId`, fetches the hosted
 * client-metadata document via `BrowserOAuthClient.load`. Without one, omits
 * `clientMetadata` entirely — the library then derives the atproto loopback
 * client id from `window.location`, which only resolves on a loopback origin.
 */
export async function createDefaultClient(opts: DefaultClientOptions): Promise<OAuthClientLike> {
  const handleResolver = opts.handleResolver ?? DEFAULT_HANDLE_RESOLVER;
  return opts.clientId
    ? BrowserOAuthClient.load({ clientId: opts.clientId, handleResolver })
    : new BrowserOAuthClient({ handleResolver });
}

/** Build the real `Agent`, authenticated with the given OAuth session. */
export function createDefaultAgent(session: OAuthSessionLike): AgentLike {
  return new Agent(session);
}
