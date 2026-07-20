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

/** identity + generic record writes — createReply() needs the latter. Same
 * value `packages/publish/src/oauth.ts`'s Node CLI login requests. */
const ATPROTO_SCOPE = "atproto transition:generic";

/**
 * Build a spec-correct loopback client id for the current page.
 *
 * `@atproto/oauth-client-browser`'s own default (used when `clientMetadata`
 * is omitted from the `BrowserOAuthClient` constructor) calls
 * `buildLoopbackClientId(window.location)`, which — for any page NOT at the
 * site root — folds `location.pathname` into the CLIENT ID itself (not just
 * the redirect_uri): `http://localhost/some/page?redirect_uri=...`. The
 * server-side parser (`parseOAuthLoopbackClientId`) rejects any loopback
 * client id with a path component ("Value must not contain a path
 * component"), so that default only actually works from `/`. Hedgerow's demo
 * (and any real consumer) mounts the reply box on ordinary content pages, so
 * we build our own — `http://localhost` with ONLY a query string, scope
 * embedded explicitly (the library's default omits it, which would silently
 * register a client scoped to `atproto` only, too narrow for `createReply`'s
 * writes) and `redirect_uri` set to the current page (origin + pathname, no
 * query/hash) so the OAuth redirect lands back on the same content page.
 */
function loopbackClientId(): string {
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams({ scope: ATPROTO_SCOPE, redirect_uri: redirectUri });
  return `http://localhost?${params.toString()}`;
}

export interface DefaultClientOptions {
  /**
   * URL of a hosted `client-metadata.json`, required for a real deployment.
   * Omit for local dev on a loopback origin (127.0.0.1 / [::1]): the client
   * then derives the atproto loopback client id from `window.location`.
   */
  clientId?: string;
  handleResolver?: string;
  /**
   * Override the PLC directory base (default `https://plc.directory`) —
   * for testing against a local atproto network (`@atproto/dev-env`'s
   * `TestNetworkNoAppView`, e.g. via a local PDS's own PLC), not needed
   * against the real network.
   */
  plcDirectoryUrl?: string;
  /**
   * Allow the client's authorization-server/resource metadata resolvers (and
   * `did:web` resolution) to talk to `http://` endpoints. Required for local
   * testing against a `http://localhost:<port>` authorization server (a real
   * deployment's issuer is always `https://`, so this stays `false`/unset in
   * production). See `docs/local-testing.md`.
   */
  allowHttp?: boolean;
}

/**
 * Build the real `BrowserOAuthClient`. With `clientId`, fetches the hosted
 * client-metadata document via `BrowserOAuthClient.load`. Without one, builds
 * a spec-correct loopback client id for the current page (see
 * {@link loopbackClientId}) and loads that instead — this only resolves on a
 * loopback origin (127.0.0.1 / [::1]).
 */
export async function createDefaultClient(opts: DefaultClientOptions): Promise<OAuthClientLike> {
  const handleResolver = opts.handleResolver ?? DEFAULT_HANDLE_RESOLVER;
  const rest = {
    ...(opts.plcDirectoryUrl !== undefined ? { plcDirectoryUrl: opts.plcDirectoryUrl } : {}),
    ...(opts.allowHttp !== undefined ? { allowHttp: opts.allowHttp } : {}),
  };
  return BrowserOAuthClient.load({
    clientId: opts.clientId ?? loopbackClientId(),
    handleResolver,
    ...rest,
  });
}

/**
 * Build the real `Agent`, authenticated with the given OAuth session, wrapped
 * to add `listOwnRecords` — the real `Agent` only exposes that as
 * `agent.com.atproto.repo.listRecords({ repo, collection, ... })`, which
 * needs the reader's own did threaded in as `repo` on every call; the rest of
 * `AgentLike` (getProfile/post/like/deleteLike) passes straight through.
 */
export function createDefaultAgent(session: OAuthSessionLike): AgentLike {
  const agent = new Agent(session);
  return {
    // asPublisher() (the /edit author flow) drives com.atproto.repo.* directly
    // — the wrapper must pass the real surface through, not just the
    // convenience methods above it.
    com: agent.com,
    getProfile: (params) => agent.getProfile(params),
    post: (record) => agent.post(record as Parameters<Agent["post"]>[0]),
    like: (uri, cid) => agent.like(uri, cid),
    deleteLike: (likeUri) => agent.deleteLike(likeUri),
    async listOwnRecords({ collection, limit, cursor, reverse }) {
      const { data } = await agent.com.atproto.repo.listRecords({
        repo: agent.assertDid,
        collection,
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(reverse !== undefined ? { reverse } : {}),
      });
      return { records: data.records, cursor: data.cursor };
    },
  };
}
