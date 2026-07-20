// Minimal shapes for the two pieces of the real atproto SDKs createReader
// wraps — just enough surface to drive a login and a reply write. Kept
// separate from the concrete `@atproto/oauth-client-browser` / `@atproto/api`
// types so tests can inject a fake without ever importing WebCrypto,
// IndexedDB, or a real Agent. Declared with method-shorthand syntax (not
// arrow-typed properties) so structural assignment against the real classes
// stays loose in both directions — this is what lets `default-client.ts`'s
// real `BrowserOAuthClient`/`Agent` satisfy these interfaces with no casts.

/** The bit of `OAuthSession` (from `@atproto/oauth-client-browser`) we use. */
export interface OAuthSessionLike {
  readonly did: string;
  fetchHandler(pathname: string, init?: RequestInit): Promise<Response>;
  signOut(): Promise<void>;
}

/**
 * atproto's `prompt` authorization param (OAuthAuthorizationRequestParameters).
 * `"create"` is the one createReader's `signUp()` uses — the provider's
 * forced-consent branch (public clients always get a consent screen) exempts
 * it, so a `prompt: "create"` flow lets the reader sign up on their PDS/
 * entryway and land back already authorized, no separate login step.
 */
export type OAuthPrompt = "none" | "login" | "consent" | "select_account" | "create";

/** The bit of `BrowserOAuthClient` we use. */
export interface OAuthClientLike {
  /**
   * Restores the last-used session, or — when the current URL carries an
   * OAuth callback — completes that login instead. Must be called exactly
   * once per client instance (the underlying library's contract).
   *
   * `state` distinguishes the two outcomes: it is present (a `string | null`
   * — `null` when the original `signIn`/`signUp` call passed no `state`
   * option) when this call just completed a fresh OAuth callback, and absent
   * when an existing session was resumed from cache with no callback
   * involved. This mirrors `BrowserOAuthClient.init()`'s own return type
   * exactly (`{ session; state?: never } | { session; state: string | null }
   * | undefined`) — see `Reader.takeCallbackState()` for how `createReader`
   * surfaces this to callers.
   */
  init(): Promise<{ session: OAuthSessionLike; state?: string | null } | undefined>;
  /** Redirects the browser; the returned promise only ever rejects (abort). */
  signIn(
    input: string,
    options?: { scope?: string; prompt?: OAuthPrompt; state?: string; signal?: AbortSignal },
  ): Promise<OAuthSessionLike>;
}

/** app.bsky.actor.defs#profileViewBasic (subset) — what getProfile hands back. */
export interface ProfileView {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/** One record returned by `com.atproto.repo.listRecords` (subset). */
export interface RecordListItem {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

/** Params for {@link AgentLike.listOwnRecords} — `repo` is implicit (the signed-in reader's own). */
export interface ListOwnRecordsParams {
  collection: string;
  limit?: number;
  cursor?: string;
  /** Newest-first when true — what {@link AgentLike.listOwnRecords} callers want for bounded "most recent N" scans. */
  reverse?: boolean;
}

export interface ListOwnRecordsResult {
  records: RecordListItem[];
  cursor?: string;
}

/** The bit of `@atproto/api`'s `Agent` we use. */
export interface AgentLike {
  getProfile(params: { actor: string }): Promise<{ data: ProfileView }>;
  post(record: Record<string, unknown>): Promise<{ uri: string; cid: string }>;
  /**
   * The nested `com.atproto.repo.*` XRPC methods (SLIMS-64's `asPublisher()`)
   * — the real `Agent` already exposes this shape (it's what
   * `packages/publish/src/auth.ts`'s `agentPublisher` adapts too), so
   * `createDefaultAgent`'s `new Agent(session)` satisfies this with no casts.
   * Optional here so a minimal fake `AgentLike` (getProfile/post only, as
   * used by tests that never call `asPublisher()`) doesn't need to stub it;
   * `asPublisher()` itself requires a real one at runtime.
   */
  com?: {
    atproto: {
      repo: {
        putRecord(params: {
          repo: string;
          collection: string;
          rkey: string;
          record: Record<string, unknown>;
        }): Promise<{ data: { uri: string; cid: string } }>;
        getRecord(params: {
          repo: string;
          collection: string;
          rkey: string;
        }): Promise<{ data: { value: Record<string, unknown> } }>;
        deleteRecord(params: { repo: string; collection: string; rkey: string }): Promise<unknown>;
      };
    };
  };
  /** `app.bsky.feed.like` create — writes to the signed-in reader's own repo. */
  like(uri: string, cid: string): Promise<{ uri: string; cid: string }>;
  /** Delete a like record by its own uri (rkey embedded). */
  deleteLike(likeUri: string): Promise<void>;
  /** Page `com.atproto.repo.listRecords` against the signed-in reader's own repo. */
  listOwnRecords(params: ListOwnRecordsParams): Promise<ListOwnRecordsResult>;
}
