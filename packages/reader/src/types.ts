// Public shapes for @hedgerow/reader. Kept separate from the OAuth wiring so
// consumers (and tests) can depend on them without pulling in the client.

/** com.atproto.repo.strongRef — a specific, verified record (uri + cid). */
export interface StrongRef {
  uri: string;
  cid: string;
}

/** The reader's identity once a session is active. */
export interface ReaderSession {
  did: string;
  handle: string;
  displayName?: string;
}

/** A fuller profile view, fetched on demand via {@link Reader.getProfile}. */
export interface ReaderProfile extends ReaderSession {
  avatar?: string;
}

export interface CreateReplyInput {
  /** strongRef of the thread's root post (the top of the reply chain). */
  root: StrongRef;
  /** strongRef of the post being replied to directly. */
  parent: StrongRef;
  /** Reply body. No facets (mentions/links/hashtags) in v1. */
  text: string;
}

export interface Reader {
  /**
   * Silently resume a session: restores the last-used one, or — when the page
   * just landed back from the OAuth redirect — completes the login and
   * restores that session instead. Call once on page load; safe to call more
   * than once (later calls reuse the first call's result rather than
   * re-running the OAuth client's one-time init). Resolves to `null` when
   * there is no session to resume.
   */
  restore(): Promise<ReaderSession | null>;
  /**
   * Start the OAuth login flow for `handle` and redirect the browser to their
   * PDS/authorization server. Never resolves on success — the page navigates
   * away; only rejects if the flow is aborted before the redirect happens.
   *
   * The authorization server always shows a consent screen for this kind of
   * client (a public browser app, `token_endpoint_auth_method: "none"`) — it
   * rejects silent (`prompt: "none"`) authorization for one. There is no
   * silent cross-site or cross-visit sign-in; the only silent path is
   * {@link Reader.restore} resuming an existing per-origin session.
   */
  signIn(handle: string): Promise<never>;
  /**
   * Start the OAuth **signup** flow (`prompt: "create"`) at `service` (default
   * `https://bsky.social`) and redirect the browser there. The reader creates
   * their Bluesky account on the authorization server mid-flow and lands back
   * already authorized — no separate "go create an account, then come back
   * and log in" round trip. Same redirect/never-resolves contract as
   * {@link Reader.signIn}.
   */
  signUp(service?: string): Promise<never>;
  /** Sign out and clear the local session. A no-op when already signed out. */
  signOut(): Promise<void>;
  /**
   * Fetch the signed-in reader's profile (did, handle, displayName, avatar).
   * `null` when signed out. Always hits the network — call sparingly.
   */
  getProfile(): Promise<ReaderProfile | null>;
  /**
   * Write a reply (`app.bsky.feed.post` with a reply ref) to the reader's own
   * PDS. Throws when there is no active session.
   */
  createReply(input: CreateReplyInput): Promise<StrongRef>;
}
