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

/**
 * Structural mirror of `@hedgerow/publish`'s `Publisher` contract
 * (`packages/publish/src/auth.ts`) — SLIMS-64's `Reader.asPublisher()` lets a
 * signed-in reader write records (e.g. saving an edited `site.standard.document`
 * from the demo's `/edit` route) through the SAME shape `publishSite` and
 * `@hedgerow/react`'s `Editor.*` expect. Duck-typed, not imported: per
 * docs/architecture.md's package-dependency rules, `@hedgerow/reader` must
 * never depend on `@hedgerow/publish` (read/reader vs. write/author are kept
 * decoupled) — the two packages just happen to agree on this tiny shape.
 */
export interface PublisherLike {
  did: string;
  putRecord(
    collection: string,
    rkey: string,
    record: Record<string, unknown>,
  ): Promise<{ uri: string; cid: string }>;
  /** Existing record value, or null if absent/not found. */
  getRecord(collection: string, rkey: string): Promise<Record<string, unknown> | null>;
  deleteRecord(collection: string, rkey: string): Promise<void>;
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
   *
   * `opts.state` is passed straight through to the underlying OAuth
   * `state` param, round-tripped verbatim by the authorization server and
   * handed back on {@link Reader.restore} — see
   * {@link Reader.takeCallbackState} and the package README's "Resuming
   * intent after the redirect" section for the stash-an-id-in-state pattern
   * this exists for (e.g. "which reply box was the reader signing in from").
   */
  signIn(handle: string, opts?: { state?: string }): Promise<never>;
  /**
   * Start the OAuth **signup** flow (`prompt: "create"`) at `service` (default
   * `https://bsky.social`) and redirect the browser there. The reader creates
   * their Bluesky account on the authorization server mid-flow and lands back
   * already authorized — no separate "go create an account, then come back
   * and log in" round trip. Same redirect/never-resolves contract as
   * {@link Reader.signIn}, including `opts.state`.
   */
  signUp(service?: string, opts?: { state?: string }): Promise<never>;
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
  /**
   * Adapt the signed-in reader's session to a {@link PublisherLike} — the
   * reader writing/editing records on THEIR OWN repo (SLIMS-64: the demo's
   * `/edit` author flow uses this to save a `site.standard.document` via
   * `putRecord`, the same shape `@hedgerow/publish`'s `publishSite` writes
   * through). Throws immediately when called while signed out — unlike
   * {@link Reader.createReply}, which only throws when actually invoked, this
   * fails at construction time since a Publisher with no identity behind it
   * isn't a meaningful object to hand around.
   */
  asPublisher(): PublisherLike;
  /**
   * Like `subject` (an `app.bsky.feed.like` record) on the reader's own PDS.
   * If an existing like for this exact subject is already known (via a prior
   * {@link Reader.findLike} or {@link Reader.like} call this session), that
   * like's ref is returned instead of writing a duplicate — see
   * {@link Reader.findLike}'s doc comment for the bound this dedup is subject
   * to. Throws when there is no active session.
   */
  like(subject: StrongRef): Promise<StrongRef>;
  /**
   * Delete a like record by its own uri (as returned by {@link Reader.like} or
   * {@link Reader.findLike}). Throws when there is no active session.
   */
  unlike(likeUri: string): Promise<void>;
  /**
   * Find the reader's own like of `subjectUri`, if any, by paging
   * `com.atproto.repo.listRecords` over the reader's `app.bsky.feed.like`
   * collection, newest first. There is no authenticated AppView to ask "did I
   * like this" directly, so this is the only way to know.
   *
   * **Bounded, honestly**: this pages at most ~10 pages (~1000 like records)
   * before giving up. A reader who has liked more than ~1000 things *more
   * recently* than the post in question will still be found (newest-first);
   * one who liked THIS post a very long time ago, under a mountain of more
   * recent likes, may not be — the button will then show "not liked" even
   * though a like technically exists. Liking again in that state is harmless
   * on Bluesky's side (two like records for the same subject just both count
   * toward the post's likeCount oddly) but does create a duplicate record.
   * {@link Reader.like} mitigates this by calling findLike first, so the
   * residual failure mode is narrow: a genuine double-like only happens to a
   * reader who (a) has this pathological like history AND (b) actually clicks
   * like on a post they secretly already liked ages ago. Accepted as-is for
   * v1 — see docs/architecture.md.
   *
   * Results are cached in memory for the lifetime of this `Reader` instance
   * (cleared on sign-in/sign-out), so repeated calls for the same subject
   * after the first are free.
   */
  findLike(subjectUri: string): Promise<string | null>;
  /**
   * One-shot: returns the `state` string a caller passed to {@link
   * Reader.signIn}/{@link Reader.signUp} IF the most recent {@link
   * Reader.restore} call just completed that OAuth redirect — then resets to
   * `null`, so a second call (or a call after a cached-session restore, which
   * never carries a callback state at all) always returns `null`. Call it
   * once, right after `await reader.restore()`, to recover intent that
   * doesn't survive the redirect round trip (e.g. "which reply box was open"
   * — see the package README's "Resuming intent after the redirect"
   * section).
   *
   * There is deliberately no separate "was this a fresh callback?" boolean:
   * state presence *is* that signal. A caller who only needs the boolean and
   * doesn't otherwise need a payload can pass any non-empty string as
   * `state` at sign-in time and treat a non-null return as "yes".
   */
  takeCallbackState(): string | null;
}
