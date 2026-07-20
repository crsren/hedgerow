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
| Comments UI (thread + likes) | Yes | AppView shim (`apps/demo/scripts/appview-shim.mjs`) computed off real PDS records |
| OAuth login (PAR, authorize, password login, token exchange) | Yes — verified | See [OAuth locally](#oauth-locally) below |
| Reply-from-browser write, once the reader-auth UI ships | Should work (same PDS write path publish already exercises) | Not yet driven end-to-end — see `apps/demo/e2e/oauth-reply.spec.ts` fixme stubs |

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
it would against a real PDS with a real handle. The comments island still
calls the public AppView by default (`https://public.api.bsky.app` — see
`packages/comments/src/xrpc.ts`'s `DEFAULT_APPVIEW`), since
`apps/demo/src/components/CommentThread.tsx` doesn't currently take an
`appView` override prop; for a manual click-through with local comments, use
a browser extension or local proxy to redirect `public.api.bsky.app` traffic
to `HEDGEROW_APPVIEW_URL`, or just run the Playwright suite below, which does
this automatically via network-level route interception.

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

Since `apps/demo/src/components/CommentThread.tsx` is owned by a colleague's
branch (reader-auth) and out of scope to touch here, and it has no prop to
override the AppView base URL at the call site, the spec redirects
`https://public.api.bsky.app/xrpc/**` requests to the local shim via
Playwright's `page.route()` — a network-level interception, zero source
changes to the component. `@hedgerow/react`'s `Comments.Root`/`Likes.Root`
(and the `useComments`/`useLikes` hooks under them) already accept an
`appView` prop for this exact purpose; wiring that through
`CommentThread.tsx` (e.g. via an env-driven default) would let a future dev
server skip the route-interception trick — left to whoever owns that file.

`apps/demo/e2e/oauth-reply.spec.ts` holds two `test.fixme()` stubs describing
the steps for reader login + reply, once that UI exists (see below).

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

Both changes are pure option-plumbing with default parameters — every
existing call site (all of `packages/publish`'s own tests, `anchor.ts`, and
`apps/demo/src/lib/site.ts`'s prior 1-arg `readSite(handle)` call) is
byte-identical in behavior when the new options are omitted.

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
- **`apps/demo/src/lib/site.ts`**: `loadSite()`'s live-mode branch now reads
  three additional, all-optional env vars — `HEDGEROW_PDS_URL`,
  `HEDGEROW_PLC_URL`, `HEDGEROW_RESOLVE_HANDLE_SERVICE` (defaults to
  `HEDGEROW_PDS_URL` when unset) — and threads them into the new `readSite`
  options. None of `HEDGEROW_HANDLE`'s existing live-mode behavior against the
  real network changes when they're unset. This is the only change to a file
  outside `apps/demo/scripts/`, `apps/demo/e2e/`, and `docs/`, and it's
  confined to env-var reading, as scoped.

No changes were made to `apps/demo/src/components/*` or `packages/react` (out
of scope — a colleague is building reader OAuth there concurrently).

## OAuth locally

**Verdict: confirmed working, fully offline, end to end** — PAR, the
authorization-server discovery, the real password-login page, and the token
exchange all completed in a real (headless Chromium) browser against nothing
but a local `TestNetworkNoAppView`, using `@atproto/oauth-client-node`
exactly as `packages/publish/src/oauth.ts` uses it for the CLI publish flow.

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

### What that means for the reader-auth branch

A browser OAuth client (`@atproto/oauth-client-browser`, built on the same
`@atproto/oauth-client` core) should work identically: point its
`handleResolver` and `plcDirectoryUrl` at `HEDGEROW_PDS_URL`/`HEDGEROW_PLC_URL`
(the same env vars `dev-net.mjs` already exports) and set the equivalent of
`allowHttp: true` for local dev. `apps/demo/e2e/oauth-reply.spec.ts` has two
`test.fixme()` stubs already written against this — turn them into real specs
once the login button + reply box exist, using a **third** seeded local
account (not `alice`/`bob`) as the reader.

### Not yet verified

- The reply write path itself (`com.atproto.repo.createRecord` from a
  reader's own OAuth session) — there's no reply UI yet to test against,
  though it's the exact write primitive `publishSite`/`agentPublisher`
  already exercise in `roundtrip.test.ts`, just through an `Agent` backed by
  an `OAuthSession` instead of a password-authenticated `AtpAgent`.
- DPoP nonce/refresh edge cases under a long-lived session — the smoke test
  only exercised a single fresh login.
