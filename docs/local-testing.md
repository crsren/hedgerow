# Local end-to-end testing

How to exercise the whole demo UX — publish, site render, comments, and
(reader) OAuth login — against a **fully local atproto network**. No Docker,
no live network, no real accounts. Everything here runs offline.

The foundation is `@atproto/dev-env`'s `TestNetworkNoAppView`: an in-process
PLC directory + PDS (SQLite-backed), the same primitive
`packages/publish/test/roundtrip.test.ts` already used for the publish round
trip. This doc extends that to the demo app and the comments read path.

## What's provable fully locally

| Layer | Provable locally? | How |
| --- | --- | --- |
| Publish (markdown -> records on a PDS) | Yes | `TestNetworkNoAppView`, already covered by `packages/publish/test/roundtrip.test.ts` |
| Site render from PDS records (live mode) | Yes | `apps/demo/scripts/dev-net.mjs` + `HEDGEROW_PDS_URL`/`HEDGEROW_PLC_URL` overrides |
| Comments UI (thread + likes) | Yes | AppView shim (`apps/demo/scripts/appview-shim.mjs`), read via `Comments.Root`/`Likes.Root`'s `appView` prop (env-driven — see [Wiring the reply UI to the local network](#wiring-the-reply-ui-to-the-local-network)) |
| Reader OAuth login from the actual UI (PAR, authorize, password login, consent, redirect, session restore) | Yes — verified | `apps/demo/e2e/oauth-reply.spec.ts`, driving `@hedgerow/react`'s `Reply.*` parts + `@hedgerow/reader`'s `BrowserOAuthClient` wiring in a real headless Chromium. See [OAuth locally](#oauth-locally) and [Reply-from-browser write](#reply-from-browser-write) below. |
| Reply-from-browser write (`com.atproto.repo.createRecord` from a reader's own OAuth session) | Yes — verified | Same spec: a real reply lands on the reader's own local repo and shows up in the thread via the shim, no reload. |

## What still needs the live network

- **Real AppView indexing behavior**: ranking, moderation label sourcing,
  federation lag, rate limits, the dataplane's actual query semantics. The
  shim computes thread/like shapes directly and synchronously from PDS
  records — it proves the CLIENT code (packages/comments, packages/react)
  handles the real response shape correctly, not that a production AppView
  would index/serve it identically or as fast.
- **bsky.app interop**: whether a real post minted this way renders correctly
  in the actual Bluesky app, whether real accounts can see/reply to it, actual
  push notifications, etc.
- **DNS-handle resolution** (`_atproto` TXT record / `.well-known/atproto-did`
  for handles on a real domain) — local test accounts use PDS-hosted `.test`
  handles resolved directly against the PDS, which is a different code path
  from DNS-based handle resolution `packages/comments`/`packages/publish` use
  against the public network.
- **A real `full TestNetwork`** (with `@atproto/bsky` AppView + dataplane) —
  deliberately out of scope: it needs Postgres/Redis, and we're avoiding
  Docker for this harness.

## Running it

### 1. Publish loop only (no demo app)

```
pnpm --filter @hedgerow/publish test
```

Runs `packages/publish/test/roundtrip.test.ts` — the existing, unmodified
foundation this whole harness builds on.

### 2. Interactive dev network

```
pnpm --filter @hedgerow/demo dev:net
```

Boots the local PLC + PDS, creates two local-only accounts (`alice.test` the
site owner, `bob.test` a commenter), publishes the **actual** posts in
`apps/demo/posts/` through the real `@hedgerow/publish` package, seeds a
couple of `bob.test` replies + a like onto the first document, starts the
AppView shim, and prints the env vars to point the demo at it:

```
export HEDGEROW_HANDLE=alice.test
export HEDGEROW_PDS_URL=http://localhost:PORT
export HEDGEROW_PLC_URL=http://localhost:PORT
export HEDGEROW_RESOLVE_HANDLE_SERVICE=http://localhost:PORT
export HEDGEROW_APPVIEW_URL=http://127.0.0.1:PORT
```

In another terminal, with those exported:

```
pnpm --filter @hedgerow/demo dev
```

The site now renders from the local PDS's real records (live mode), same as
it would against a real PDS with a real handle. The printed exports include
the four `PUBLIC_HEDGEROW_*` vars, so the comments island reads threads/likes
from the local AppView shim and the reply box's OAuth client points at the
local PDS — the full UX (browse, log in as `carol.test`, reply) works
interactively in your own browser, all offline. Without the `PUBLIC_` vars
exported, the island falls back to the public AppView and real OAuth, same
as production.

Press Ctrl-C to tear the network down.

### 3. Playwright E2E (automated, headless)

```
pnpm --filter @hedgerow/demo e2e:install   # once: npx playwright install chromium
pnpm --filter @hedgerow/demo e2e
```

`apps/demo/playwright.config.ts`'s `webServer` runs `apps/demo/e2e/serve.mjs`,
which:

1. Calls `startDevNet()` (exported from `dev-net.mjs`) to boot the network,
   publish, and seed the thread — same as `dev:net` above.
2. Writes the resulting env + seeded-document metadata to
   `apps/demo/e2e/.local-net.json` (gitignored, regenerated every run) for the
   specs to read.
3. Spawns `astro dev` with `HEDGEROW_HANDLE`/`HEDGEROW_PDS_URL`/… set, so the
   demo renders in live mode against the local PDS.

Playwright waits for the astro server to respond, runs the specs, then
SIGTERMs the whole tree (astro + the local network + the shim) — see the
teardown in `serve.mjs`.

`apps/demo/e2e/read-path.spec.ts` proves the READ path end to end in a real
(headless Chromium) browser:

- the home page's `<link rel="site.standard.publication">` has a real
  `at://did:plc:…` href — proof it's rendered from a PDS record, not local
  markdown;
- the post page renders from its `site.standard.document` record;
- the comment thread hydrates and shows `bob.test`'s two seeded replies;
- the like count shows the seeded like.

`apps/demo/src/components/CommentThread.tsx` reads four `PUBLIC_`-prefixed
env vars (`import.meta.env` — Astro/Vite only expose that prefix to browser
code) and threads them into `createReader()` and `Comments.Root`/
`Likes.Root`'s `appView` prop: `PUBLIC_HEDGEROW_APPVIEW_URL`,
`PUBLIC_HEDGEROW_HANDLE_RESOLVER`, `PUBLIC_HEDGEROW_PLC_URL`,
`PUBLIC_HEDGEROW_OAUTH_ALLOW_HTTP`. `dev-net.mjs`'s `env` object sets all
four (see [Wiring the reply UI to the local network](#wiring-the-reply-ui-to-the-local-network)
below), so `serve.mjs` spawning `astro dev` with that env already points the
comments island and the reader's OAuth client at the local network — no
`page.route()` interception needed (an earlier version of this spec used
that trick before the env plumbing existed; it's gone now that the real prop
exists).

`apps/demo/e2e/oauth-reply.spec.ts` is a real, passing spec (no more
`test.fixme()` stubs): it drives the actual "Log in with Bluesky" UI as a
third seeded account (`carol.test`, added in `dev-net.mjs` — not `alice`
the owner or `bob` the seeded commenter), completes the real password +
consent screens, and posts a real reply that shows up in the thread. See
[Reply-from-browser write](#reply-from-browser-write) below for exactly what
that proved and what plumbing it took.

CI-runnable as-is: headless Chromium, single worker, `forbidOnly`/retry wired
off `process.env.CI`. Kept out of the default `pnpm test` (turbo's `test`
task) — it's a separate `e2e` script with no turbo task defined for it.

## The AppView shim

`apps/demo/scripts/appview-shim.mjs` is a small dependency-free HTTP server
(Node's `http`, no Express) implementing the three XRPC methods the comments
read core needs, computed live off the local PDS:

- **`app.bsky.feed.getPostThread`** — walks `reply.parent.uri` backlinks
  across every known local account's `app.bsky.feed.post` records
  (`com.atproto.repo.listRecords`) to build the same nested
  `threadViewPost`/`notFoundPost` shape `packages/comments/src/thread.ts`
  normalizes. Like counts come from matching `app.bsky.feed.like` records.
- **`app.bsky.feed.getLikes`** — pages `app.bsky.feed.like` records whose
  `subject.uri` matches, newest first.
- **`com.atproto.identity.resolveHandle`** — proxied straight to the PDS,
  which already implements this for the accounts it hosts (see
  `serviceHandleDomains: ['.test', '.example']` in dev-env's `TestPds`).

Response shapes were checked against real captured fixtures in
`packages/comments/test/fixtures/*.json` (via
`packages/comments/scripts/capture-fixtures.mjs`) to keep them close enough
that `packages/comments`'s normalization code — and therefore
`packages/react` and `CommentThread.tsx` — treats the shim identically to
production. CORS headers are set so a real browser can call across origins
(astro dev server -> shim, different ports), same as the public AppView.

`accounts` is a live `Map<did, {handle, displayName}>` the shim reads on
every request — `dev-net.mjs` never needs to restart it after creating new
accounts.

## Plumbing added to packages (why it's additive and safe)

All of this is option-plumbing with default parameters, or reads of new
`PUBLIC_`-prefixed env vars that are absent in production — every existing
call site is byte-identical in behavior when the new options/env vars are
omitted.

- **`packages/publish/src/read.ts`**: `resolveDid`, `resolvePds`, and
  `readSite` each gained an optional trailing `opts` parameter:
  - `resolveDid(identifier, fetchImpl, { service })` — override the
    `com.atproto.identity.resolveHandle` base URL (default: the public bsky
    AppView). A PDS implements this for its own accounts, so pointing
    `service` at a local PDS resolves local test handles offline.
  - `resolvePds(identifier, fetchImpl, { service, plcUrl })` — `plcUrl`
    overrides the PLC directory base (default `https://plc.directory`).
  - `readSite(identifier, fetchImpl, { service, plcUrl, pds })` — `pds` skips
    DID-document resolution (and PLC) entirely and reads straight from that
    PDS, once the identifier is resolved to a DID.
- **`apps/demo/src/lib/site.ts`**: `loadSite()`'s live-mode branch reads
  three additional, all-optional env vars — `HEDGEROW_PDS_URL`,
  `HEDGEROW_PLC_URL`, `HEDGEROW_RESOLVE_HANDLE_SERVICE` (defaults to
  `HEDGEROW_PDS_URL` when unset) — and threads them into the new `readSite`
  options. None of `HEDGEROW_HANDLE`'s existing live-mode behavior against the
  real network changes when they're unset.
- **`packages/reader/src/default-client.ts`**: `createDefaultClient()` gained
  `plcDirectoryUrl?: string` and `allowHttp?: boolean`, passed straight
  through to `BrowserOAuthClient` — the browser-OAuth equivalent of
  `resolvePds`'s `plcUrl`/the Node OAuth client's `allowHttp`. `createReader()`
  (`reader.ts`) threads both through unchanged from its own options.
- **`apps/demo/src/components/CommentThread.tsx`**: reads four
  `PUBLIC_HEDGEROW_*` env vars (see above) and passes them into
  `createReader()` and `Comments.Root`/`Likes.Root`'s `appView`. All four are
  `undefined` in production, so `createReader()` and the comments island fall
  back to their normal defaults exactly as before this work.

### Two real bugs, not just local-net wiring

Driving the actual UI through a real login (rather than assuming the library
would "just work") surfaced two genuine bugs in `@hedgerow/reader`, now fixed
in `packages/reader/src/default-client.ts` — both would have broken the
reply flow in production too, on any page that isn't the site root:

1. **The loopback client id embedded the page's own path.**
   `@atproto/oauth-client-browser`'s default (`buildLoopbackClientId`, used
   whenever `clientMetadata` is omitted from the `BrowserOAuthClient`
   constructor) builds `http://localhost${pathname}?redirect_uri=...` — i.e.
   it folds the CURRENT PAGE'S PATH into the client id itself, not just the
   redirect target. `parseOAuthLoopbackClientId` (server-side, used by every
   atproto authorization server including this local PDS's real
   `@atproto/oauth-provider`) rejects any loopback client id with a path
   component: `TypeError: Invalid loopback client ID: Value must not contain
   a path component`. This only ever surfaces on a non-root page — which is
   exactly what a per-post comment/reply box is. `createDefaultClient()` now
   builds its own loopback client id (`http://localhost?scope=...&redirect_uri=<origin+pathname>`)
   and always routes through `BrowserOAuthClient.load()`.
2. **The default loopback client id has no scope, defaulting to `atproto`
   only.** `createReply()` needs `transition:generic` to write records; a
   client registered for `atproto` alone would have its record-write
   authorize requests rejected server-side. Every `signIn()`/`signUp()` call
   now explicitly requests `scope: "atproto transition:generic"`, and the
   loopback client id embeds the same scope.

A third finding was environmental, not a bug: right after the OAuth redirect,
`restore()`'s profile fetch (`agent.getProfile`) 502'd, because this local
network's bare `TestPds` has no AppView to proxy `app.bsky.actor.getProfile`
to. `restore()` previously let that failure reject the whole call — which
would have made a genuinely successful login look like it failed. It now
falls back to the reader's `did` as a placeholder handle when the profile
fetch fails, so a real session is never thrown away over a secondary,
transient failure (`packages/reader/src/reader.ts`, with unit coverage in
`packages/reader/test/reader.test.ts`). On a real deployment (a real PDS
backed by a real AppView) this fallback essentially never triggers — the
demo's `Reply.SignedIn` "Replying as …" text just shows the DID instead of
the handle when it does.

Both client-id bugs, the restore() fallback, their tests, and this doc
update landed together with the real spec — per "finish cutovers
completely," no fixme stubs or route-interception tricks left behind.

## OAuth locally

**Verdict: confirmed working, fully offline, end to end** — PAR, the
authorization-server discovery, the real password-login page, and the token
exchange all completed in a real (headless Chromium) browser against nothing
but a local `TestNetworkNoAppView`. This was first confirmed with
`@atproto/oauth-client-node`, exactly as `packages/publish/src/oauth.ts` uses
it for the CLI publish flow (below); the same is now also confirmed with the
actual browser client, `@atproto/oauth-client-browser`, driven through the
real reply UI — see [Confirmed for the browser client
too](#confirmed-for-the-browser-client-too) further down.

### Why this works

`@atproto/dev-env`'s `TestPds` boots a **real `@atproto/pds`** instance with
`devMode: true` and no `entryway` configured. Looking at `@atproto/pds`'s own
config resolution (`packages/pds` — `envToCfg`):

```js
const oauthCfg = entrywayCfg
  ? { issuer: entrywayCfg.url, provider: undefined }
  : { issuer: serviceCfg.publicUrl, provider: { /* … */ } };
```

No entryway means `oauth.provider` is always set, and `context.js` always
constructs a full `OAuthProvider` (from `@atproto/oauth-provider`) with
`issuer: cfg.oauth.issuer` (the PDS's own URL). `auth-routes.js` mounts it at
`/oauth/*` plus `/.well-known/oauth-protected-resource`, and
`devMode: true` is what lets the issuer be a plain `http://` URL (production
requires `https://`). Confirmed live:

```
$ curl http://localhost:<port>/.well-known/oauth-authorization-server
{
  "issuer": "http://localhost:<port>",
  "authorization_endpoint": "http://localhost:<port>/oauth/authorize",
  "token_endpoint": "http://localhost:<port>/oauth/token",
  "pushed_authorization_request_endpoint": "http://localhost:<port>/oauth/par",
  …
}
```

On the client side, `@atproto/oauth-client-node`'s `NodeOAuthClient` (and the
shared `@atproto/oauth-client` core any browser OAuth client also builds on)
accepts the same shape of override our `read.ts` plumbing does:

- `handleResolver: <url>` — a string/URL builds an `XrpcHandleResolver`
  against that base, i.e. it calls `com.atproto.identity.resolveHandle` there
  instead of doing DNS/`.well-known` resolution. Point it at the local PDS.
- `plcDirectoryUrl: <url>` — same override as our `resolvePds`'s `plcUrl`.
- `allowHttp: true` — required in addition to the two above: the client's
  own resource/authorization-server metadata resolvers refuse `http://`
  URLs unless this is set (a safety default, not a local-net limitation).

### What was actually driven, end to end

A throwaway script (not committed — this was a verification step, not a
deliverable) did the following against a fresh `TestNetworkNoAppView`, with
no live network calls at any point:

1. Built a `NodeOAuthClient` with `handleResolver`/`plcDirectoryUrl` pointed
   at the local PDS/PLC and `allowHttp: true`, using the same loopback client
   metadata (`buildAtprotoLoopbackClientMetadata`) `oauthPublisher` uses.
2. Called `client.authorize("alice.test", { scope: "atproto transition:generic" })`
   → got back a real `/oauth/authorize?...&request_uri=urn:ietf:params:oauth:request_uri:req-…`
   URL — i.e. the PAR round trip to `/oauth/par` succeeded and the identity
   resolver correctly turned `alice.test` into its DID via the local PDS.
3. Opened that URL in a real headless Chromium page (Playwright) — got a
   fully rendered **"Sign in"** page from `@atproto/oauth-provider`'s actual
   frontend bundle, with the identifier pre-filled and locked to
   `alice.test` and a password field.
4. Filled the password, submitted, clicked through the consent/accept screen.
5. The browser was redirected to the loopback callback
   (`http://127.0.0.1:4139/callback?state=…&iss=…&code=…`).
6. `client.callback(url.searchParams)` completed the token exchange and
   returned a live `OAuthSession` for the correct DID.

Every step ran against `localhost` ports only.

### Confirmed for the browser client too

The prediction below this heading used to be "should work identically" —
it's now verified. `@hedgerow/reader`'s `createDefaultClient()` points
`BrowserOAuthClient`'s `handleResolver`/`plcDirectoryUrl` at
`PUBLIC_HEDGEROW_HANDLE_RESOLVER`/`PUBLIC_HEDGEROW_PLC_URL` (the client-side
counterparts of `HEDGEROW_RESOLVE_HANDLE_SERVICE`/`HEDGEROW_PLC_URL`) and
`allowHttp: true` via `PUBLIC_HEDGEROW_OAUTH_ALLOW_HTTP`, all set by
`dev-net.mjs` and threaded through by `CommentThread.tsx`.
`apps/demo/e2e/oauth-reply.spec.ts` drives the real "Log in with Bluesky" UI
as `carol.test` (a third seeded account, distinct from `alice`/`bob`) through
the actual `/oauth/authorize` → password → consent → redirect flow, in a real
headless Chromium, with zero live network calls. See [Two real bugs, not
just local-net wiring](#two-real-bugs-not-just-local-net-wiring) above for
what that surfaced and fixed.

### Also now verified

- **The reply write path** (`com.atproto.repo.createRecord` from a reader's
  own OAuth session): `apps/demo/e2e/oauth-reply.spec.ts`'s second test types
  a reply, submits it, and asserts the text shows up in the thread — a real
  write landing on `carol.test`'s own repo, picked up by the AppView shim on
  the demo's indexing-lag retry (no page reload).

### Not yet verified

- DPoP nonce/refresh edge cases under a long-lived session — every run here
  (Node script and Playwright spec alike) exercises a single fresh login,
  not hours of use.
- Real Bluesky's actual `@atproto/oauth-provider` deployment and UI — this is
  verified against the exact same `@atproto/oauth-provider` package version
  the real service runs, but not against the real service's own hosted
  instance/branding/customization.
