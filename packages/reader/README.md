# @hedgerow/reader

Browser-side reader identity for Bluesky comments: atproto OAuth login (via [`@atproto/oauth-client-browser`](https://www.npmjs.com/package/@atproto/oauth-client-browser)) and writing a reply post to the reader's own PDS. This is v1 of "comment in place" — a reader logs into *their own* Bluesky account in your page and posts a real `app.bsky.feed.post` reply, no redirect to bsky.app required.

Framework-agnostic (no React) so [`@hedgerow/react`](../react)'s `Reply.*` parts stay dependency-light — you wire the two together yourself. See [`docs/architecture.md`](../../docs/architecture.md) for the dependency rule.

Sessions are per-origin: each domain that embeds a comment box gets its own login and its own cached session, in that browser's IndexedDB. There is no cross-site single sign-on in v1.

## Install

```bash
npm install @hedgerow/reader
```

## Quick start

```ts
import { createReader } from "@hedgerow/reader";

const reader = createReader(); // loopback client id in dev; see Client ID below for prod

// Once per page load — resumes the last session, or completes a pending
// OAuth redirect if the page just landed back from one.
const session = await reader.restore(); // { did, handle, displayName? } | null

if (!session) {
  // Existing account: redirects the browser to the reader's PDS/authorization
  // server. Never resolves on success.
  await reader.signIn("someone.bsky.social");

  // New to Bluesky: signUp() starts the flow with prompt: "create" instead of
  // a handle — the reader creates their account on the authorization server
  // mid-flow and lands back here already authorized. No separate "go create
  // an account, then come back and log in" round trip.
  await reader.signUp(); // defaults to https://bsky.social; pass a different service to override
}

const reply = await reader.createReply({
  root: { uri: "at://did:plc:.../app.bsky.feed.post/abc", cid: "bafy..." },
  parent: { uri: "at://did:plc:.../app.bsky.feed.post/abc", cid: "bafy..." },
  text: "Great post!",
});
// { uri, cid } of the new reply record, written to the reader's own PDS.

await reader.signOut();
```

## API

```ts
function createReader(options?: CreateReaderOptions): Reader;

interface CreateReaderOptions {
  clientId?: string;          // hosted client-metadata.json URL; omit for loopback dev
  handleResolver?: string;    // resolves handles to DIDs; default the public Bluesky AppView
  plcDirectoryUrl?: string;   // override the PLC directory; local/test networks only
  allowHttp?: boolean;        // allow http:// AS/resource metadata endpoints; local/test networks only
  createClient?(): OAuthClientLike | Promise<OAuthClientLike>;  // test seam
  createAgent?(session: OAuthSessionLike): AgentLike;           // test seam
}

interface Reader {
  restore(): Promise<ReaderSession | null>;
  signIn(handle: string, opts?: { state?: string }): Promise<never>;    // redirects; never resolves on success
  signUp(service?: string, opts?: { state?: string }): Promise<never>;  // prompt: "create"; default service https://bsky.social
  signOut(): Promise<void>;
  getProfile(): Promise<ReaderProfile | null>;  // did, handle, displayName, avatar — always hits the network
  createReply(input: CreateReplyInput): Promise<StrongRef>;
  asPublisher(): PublisherLike;  // throws immediately if signed out
  like(subject: StrongRef): Promise<StrongRef>;     // app.bsky.feed.like; deduped against findLike first
  unlike(likeUri: string): Promise<void>;
  findLike(subjectUri: string): Promise<string | null>;  // "did I like this?" — see the bound below
  takeCallbackState(): string | null;  // one-shot; see "Resuming intent after the redirect" below
}

interface ReaderSession { did: string; handle: string; displayName?: string }
interface ReaderProfile extends ReaderSession { avatar?: string }
interface StrongRef { uri: string; cid: string }
interface CreateReplyInput {
  root: StrongRef;    // the thread's root post
  parent: StrongRef;  // the post being replied to directly
  text: string;       // no facets (mentions/links/hashtags) in v1
}
interface PublisherLike {
  did: string;
  putRecord(collection: string, rkey: string, record: Record<string, unknown>): Promise<{ uri: string; cid: string }>;
  getRecord(collection: string, rkey: string): Promise<Record<string, unknown> | null>;  // null if absent
  deleteRecord(collection: string, rkey: string): Promise<void>;
}
```

### Writing your own records: `asPublisher()`

A signed-in reader isn't just a commenter — on your own page, the same session can be the site's *author*, editing their own records. `asPublisher()` adapts the current session to `{ did, putRecord, getRecord, deleteRecord }`, the exact structural shape [`@hedgerow/publish`](../publish)'s `Publisher` interface uses (duck-typed, not imported — this package never depends on `@hedgerow/publish`; see [`docs/architecture.md`](../../docs/architecture.md)'s package-dependency rules):

```ts
const session = await reader.restore();
if (session) {
  const publisher = reader.asPublisher(); // throws if called while signed out
  await publisher.putRecord("site.standard.document", rkey, updatedRecord);
}
```

The three methods close over the live session, so a `Publisher` built before a later `signOut()` correctly starts throwing on use afterward too, rather than silently keeping a stale session alive. `apps/demo`'s `/edit` route is the reference consumer: the signed-in author edits a `site.standard.document` with [`@hedgerow/react`](../react)'s `Editor.*` parts and saves it via `asPublisher().putRecord(...)`.

`restore()` is the only call you need on page load: it transparently handles both "returning visitor with a cached session" and "just landed back from the OAuth redirect" — the underlying `BrowserOAuthClient.init()` distinguishes them internally. It's safe to call more than once (e.g. a component mounting twice under React Strict Mode); later calls reuse the first call's result rather than re-running the OAuth client's one-time init.

## Liking a post

```ts
const ref = await reader.like({ uri: post.uri, cid: post.cid }); // { uri, cid } of the new like record
await reader.unlike(ref.uri);
```

There is no authenticated AppView to ask "did I like this" directly — the public AppView (what `@hedgerow/comments` reads) has no viewer state. `findLike` answers it instead by paging the reader's own `app.bsky.feed.like` collection via `com.atproto.repo.listRecords`, newest first:

```ts
const likeUri = await reader.findLike(post.uri); // the like's own uri, or null
```

**The bound, honestly**: this pages at most ~10 pages (~1000 like records) before giving up. A reader who has liked more than ~1000 things *more recently* than the post in question is still found (it's newest-first); one who liked THIS post a long time ago, buried under a mountain of more recent likes, may come back `null` even though a like technically exists — the button would then show "not liked". Liking again in that state is harmless on Bluesky's side (both records just count toward the post's `likeCount`) but does create a duplicate record. `like()` mitigates this by calling `findLike` first and reusing the existing ref instead of writing a new one, so the residual failure mode narrows to a reader who both (a) has that pathological like history and (b) clicks like on a post they secretly already liked ages ago — accepted as-is for v1.

Results are cached in memory for the lifetime of the `Reader` instance (cleared on sign-in/out), so repeated `findLike`/`like` calls for the same subject after the first are free — no re-paging.

## Client ID

The OAuth `client_id` tells the authorization server who's asking. `@hedgerow/reader` supports both stories atproto OAuth defines for a public client:

- **Local dev, on a loopback origin (`127.0.0.1` / `[::1]`)** — omit `clientId`. `default-client.ts` builds a spec-correct loopback client id for the current page — `http://localhost?scope=atproto+transition%3Ageneric&redirect_uri=<origin+pathname>` — and loads it via `BrowserOAuthClient.load()`; the authorization server synthesizes matching client metadata for it, so there's nothing to host. This is **not** the same as `@atproto/oauth-client-browser`'s own default (letting `clientMetadata` fall through to its internal `buildLoopbackClientId(window.location)`): that default folds the page's pathname into the client id *itself*, which the provider rejects outside the site root, and it omits `scope` entirely (defaulting to `atproto` only — too narrow for `createReply()`'s writes). Only works on an actual loopback address (not `localhost` — the library redirects `localhost` → `127.0.0.1`), and gets short-lived refresh tokens (~1 day) with no silent sign-in, per the atproto spec.

- **A real deployment** — pass `clientId` pointing at a hosted `client-metadata.json` (the URL *is* the client id). `createReader({ clientId: "https://example.com/oauth/client-metadata.json" })` fetches it via `BrowserOAuthClient.load()`. An example document is at [`apps/demo/public/oauth/client-metadata.json`](../../apps/demo/public/oauth/client-metadata.json) — copy it, update `client_id`/`client_uri`/`redirect_uris` to your real domain, and serve it from that exact URL. It only takes effect once it's live on a real domain; the demo repo can't self-host its own client metadata for local testing (that's what the loopback path is for).

Every authorize call (`signIn()`/`signUp()`) explicitly requests `scope: "atproto transition:generic"`, matching what's embedded in both the loopback client id and `client-metadata.json` — requesting more than a client's own registered scope is rejected server-side, so keep the two in sync if you fork the hosted metadata document.

## Consent

Both `signIn()` and `signUp()` land on a consent screen every time, on the reader's own authorization server — this is enforced server-side, not a choice `@hedgerow/reader` makes. `@atproto/oauth-provider` forces consent for any client whose `token_endpoint_auth_method` is `"none"` (a public browser SPA is exactly that) and rejects a silent (`prompt: "none"`) authorization request outright. `signUp()`'s `prompt: "create"` is the one value the provider exempts from that forced-consent gate — it's what lets a *new* account land back authorized without an extra approval step, not a way to skip consent for an *existing* one.

The only silent path here is `restore()` resuming a session already cached in this origin's IndexedDB. There is no silent sign-in across a fresh login, and no cross-site session sharing — word your UI accordingly ("you'll approve access on your Bluesky server"), not as an "instant" login.

## Resuming intent after the redirect

`signIn()`/`signUp()` navigate the whole page away to the reader's authorization server and back — anything held in memory (which reply box was open, what the reader had typed, which post they were replying to) is gone by the time `restore()` runs on the reloaded page. `opts.state` on `signIn`/`signUp`, paired with `Reader.takeCallbackState()`, is how you carry a small piece of that intent through the round trip: it's passed straight through to the OAuth `state` parameter, which the authorization server round-trips verbatim and hands back on the callback.

```ts
// Before redirecting — stash an id for whatever the reader was doing.
await reader.signIn(handle, { state: replyBoxId });

// After the redirect, once per page load:
const session = await reader.restore();
const replyBoxId = reader.takeCallbackState(); // the id, or null
if (replyBoxId) {
  // scroll back to / re-open that specific reply box, now signed in
}
```

`takeCallbackState()` is **one-shot**: it returns the stashed value the first time it's called after a `restore()` that completed a fresh OAuth callback, then resets to `null` — a second call, or any call after a `restore()` that instead resumed a session from cache (no redirect involved), returns `null`. There is no separate "was this a fresh callback?" boolean: the presence of a non-null state *is* that signal. If you only need the boolean and have no payload to carry, pass any non-empty string as `state` and treat a non-null `takeCallbackState()` return as "yes, this restore just completed a callback."

Keep whatever you put in `state` small and non-sensitive — it round-trips through the authorization server and the URL, not a private channel. An opaque id you use to look up local state (like `replyBoxId` above) is the intended shape, not the state itself.

## Handle resolver

Resolving a handle (e.g. `someone.bsky.social`) to a DID needs a DNS lookup the browser can't do itself, so `BrowserOAuthClient` delegates it to an HTTP service implementing `com.atproto.identity.resolveHandle`. `@hedgerow/reader` defaults `handleResolver` to `https://public.api.bsky.app` (the same AppView `@hedgerow/comments` reads from) for convenience.

**Privacy note:** any Bluesky-hosted resolver (the default, or `https://bsky.social`) sees the handle being resolved and the caller's IP. If you self-host a PDS, pass its URL as `handleResolver` instead to keep that resolution off Bluesky's infrastructure.

## Testing

Unit tests inject both `createClient` and `createAgent`, so nothing in `test/reader.test.ts` ever touches WebCrypto, IndexedDB, or the network — see the file header for the full rationale. `src/default-client.ts` (the real `BrowserOAuthClient`/`Agent` wiring) is exercised for real, automatically, by `apps/demo`'s Playwright suite (`pnpm --filter demo e2e`) — see [`docs/local-testing.md`](../../docs/local-testing.md) for how that drives an actual `/oauth/authorize` → password → consent → redirect flow against a fully local atproto network, with no live network involved.

`restore()` is resilient to a failed profile fetch right after login: the session itself is valid the moment the OAuth redirect completes, but `getProfile()` (a separate `app.bsky.actor.getProfile` call) can fail independently — e.g. on a bare local test PDS with no AppView to proxy to. Rather than let that collapse a genuinely successful login back to "signed out," `restore()` falls back to the reader's `did` as a placeholder handle; a later `getProfile()` call fills in the real one once/if it succeeds. On a real deployment (a real PDS backed by a real AppView) this fallback essentially never triggers.

## License

[MIT](../../LICENSE)
