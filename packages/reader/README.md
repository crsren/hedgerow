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
  signIn(handle: string): Promise<never>;      // redirects; never resolves on success
  signUp(service?: string): Promise<never>;    // prompt: "create"; default service https://bsky.social
  signOut(): Promise<void>;
  getProfile(): Promise<ReaderProfile | null>;  // did, handle, displayName, avatar — always hits the network
  createReply(input: CreateReplyInput): Promise<StrongRef>;
}

interface ReaderSession { did: string; handle: string; displayName?: string }
interface ReaderProfile extends ReaderSession { avatar?: string }
interface StrongRef { uri: string; cid: string }
interface CreateReplyInput {
  root: StrongRef;    // the thread's root post
  parent: StrongRef;  // the post being replied to directly
  text: string;       // no facets (mentions/links/hashtags) in v1
}
```

`restore()` is the only call you need on page load: it transparently handles both "returning visitor with a cached session" and "just landed back from the OAuth redirect" — the underlying `BrowserOAuthClient.init()` distinguishes them internally. It's safe to call more than once (e.g. a component mounting twice under React Strict Mode); later calls reuse the first call's result rather than re-running the OAuth client's one-time init.

## Client ID

The OAuth `client_id` tells the authorization server who's asking. `@hedgerow/reader` supports both stories atproto OAuth defines for a public client:

- **Local dev, on a loopback origin (`127.0.0.1` / `[::1]`)** — omit `clientId`. `default-client.ts` builds a spec-correct loopback client id for the current page — `http://localhost?scope=atproto+transition%3Ageneric&redirect_uri=<origin+pathname>` — and loads it via `BrowserOAuthClient.load()`; the authorization server synthesizes matching client metadata for it, so there's nothing to host. This is **not** the same as `@atproto/oauth-client-browser`'s own default (letting `clientMetadata` fall through to its internal `buildLoopbackClientId(window.location)`): that default folds the page's pathname into the client id *itself*, which the provider rejects outside the site root, and it omits `scope` entirely (defaulting to `atproto` only — too narrow for `createReply()`'s writes). Only works on an actual loopback address (not `localhost` — the library redirects `localhost` → `127.0.0.1`), and gets short-lived refresh tokens (~1 day) with no silent sign-in, per the atproto spec.

- **A real deployment** — pass `clientId` pointing at a hosted `client-metadata.json` (the URL *is* the client id). `createReader({ clientId: "https://example.com/oauth/client-metadata.json" })` fetches it via `BrowserOAuthClient.load()`. An example document is at [`apps/demo/public/oauth/client-metadata.json`](../../apps/demo/public/oauth/client-metadata.json) — copy it, update `client_id`/`client_uri`/`redirect_uris` to your real domain, and serve it from that exact URL. It only takes effect once it's live on a real domain; the demo repo can't self-host its own client metadata for local testing (that's what the loopback path is for).

Every authorize call (`signIn()`/`signUp()`) explicitly requests `scope: "atproto transition:generic"`, matching what's embedded in both the loopback client id and `client-metadata.json` — requesting more than a client's own registered scope is rejected server-side, so keep the two in sync if you fork the hosted metadata document.

## Consent

Both `signIn()` and `signUp()` land on a consent screen every time, on the reader's own authorization server — this is enforced server-side, not a choice `@hedgerow/reader` makes. `@atproto/oauth-provider` forces consent for any client whose `token_endpoint_auth_method` is `"none"` (a public browser SPA is exactly that) and rejects a silent (`prompt: "none"`) authorization request outright. `signUp()`'s `prompt: "create"` is the one value the provider exempts from that forced-consent gate — it's what lets a *new* account land back authorized without an extra approval step, not a way to skip consent for an *existing* one.

The only silent path here is `restore()` resuming a session already cached in this origin's IndexedDB. There is no silent sign-in across a fresh login, and no cross-site session sharing — word your UI accordingly ("you'll approve access on your Bluesky server"), not as an "instant" login.

## Handle resolver

Resolving a handle (e.g. `someone.bsky.social`) to a DID needs a DNS lookup the browser can't do itself, so `BrowserOAuthClient` delegates it to an HTTP service implementing `com.atproto.identity.resolveHandle`. `@hedgerow/reader` defaults `handleResolver` to `https://public.api.bsky.app` (the same AppView `@hedgerow/comments` reads from) for convenience.

**Privacy note:** any Bluesky-hosted resolver (the default, or `https://bsky.social`) sees the handle being resolved and the caller's IP. If you self-host a PDS, pass its URL as `handleResolver` instead to keep that resolution off Bluesky's infrastructure.

## Testing

Unit tests inject both `createClient` and `createAgent`, so nothing in `test/reader.test.ts` ever touches WebCrypto, IndexedDB, or the network — see the file header for the full rationale. `src/default-client.ts` (the real `BrowserOAuthClient`/`Agent` wiring) is exercised for real, automatically, by `apps/demo`'s Playwright suite (`pnpm --filter demo e2e`) — see [`docs/local-testing.md`](../../docs/local-testing.md) for how that drives an actual `/oauth/authorize` → password → consent → redirect flow against a fully local atproto network, with no live network involved.

`restore()` is resilient to a failed profile fetch right after login: the session itself is valid the moment the OAuth redirect completes, but `getProfile()` (a separate `app.bsky.actor.getProfile` call) can fail independently — e.g. on a bare local test PDS with no AppView to proxy to. Rather than let that collapse a genuinely successful login back to "signed out," `restore()` falls back to the reader's `did` as a placeholder handle; a later `getProfile()` call fills in the real one once/if it succeeds. On a real deployment (a real PDS backed by a real AppView) this fallback essentially never triggers.

## License

[MIT](../../LICENSE)
