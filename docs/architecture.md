# Architecture

Design notes for the Hedgerow monorepo. Kept brief; the source is the source of truth.

## Package dependency rules

Three halves of the toolkit — writing records (the author), reading the social layer, and a reader's own identity — stay decoupled.

- **The read side must never depend on the publish side.** A site that only renders comments and likes should pull in none of `@hedgerow/publish`'s write path (OAuth login, `@atproto/api` agents, markdown parsing). Read and write are separate concerns with separate blast radii.
- **The comments core is framework-agnostic.** `@hedgerow/comments` does the reading — resolve a post, page its replies and likes off the AppView, shape them into a tree — with no React, no DOM, no framework import.
- **Renderers are thin wrappers over that core.** `@hedgerow/react` owns rendering and interaction only; every fetch/transform decision lives in the core, so all surfaces stay behaviourally identical. React components follow Base UI principles (headless, unstyled, composable). The `@hedgerow/embed` web component (planned) will be a later wrapper over the same core.
- **`@hedgerow/react` must never depend on `@hedgerow/reader`.** The `Reply.*` parts (SLIMS-66) take `session` and `onSubmit` as plain props — reader identity is entirely injected, never imported. This keeps the render layer usable with any atproto OAuth client, a server-backed auth of your own, or no reply composer at all. The **demo app** is what composes the two: `apps/demo/src/components/CommentThread.tsx` imports both `@hedgerow/react` and `@hedgerow/reader` and wires `createReader()`'s session/`createReply` into `Reply.Root`.

## Auth

Two independent identities write to atproto here: the **author** (publishing posts, `@hedgerow/publish`) and a **reader** (posting a reply from their own account, `@hedgerow/reader`). Both go through atproto OAuth; neither shares code with the other, because they run in different environments (Node CLI vs. browser) against different client types (confidential-ish native app vs. public SPA).

### Publishing (the author)

Publishing authenticates through one pluggable seam — the `Publisher` interface (`did` + `putRecord`/`getRecord`/`deleteRecord`) in `packages/publish/src/auth.ts`. `agentPublisher` adapts any `@atproto/api` `Agent` to it, so the same three methods back both the in-process test agent and a real OAuth session.

- **atproto OAuth is the only auth path.** `oauthPublisher` (`oauth.ts`) is the single way to authenticate a real publish — there is no credential- or token-based alternative. It restores a cached session if one exists, otherwise runs the login and persists the result.
- **CLI login is the loopback (native) flow.** atproto defines a client id of the form `http://localhost?scope=…&redirect_uri=…` for local clients — the authorization server synthesises the client metadata from that id, so there's no hosted client-metadata document and no client secret. We stand up a throwaway HTTP server on `127.0.0.1:<port>`, open the browser to the authorization URL, and catch the redirect there. The session (and transient auth state) persist through a small JSON file store (`store.ts`, default `~/.config/hedgerow`), and tokens refresh silently on restore.
- **No headless publish path — by design.** A record write always requires a human to complete the browser login once. There is intentionally no username/password or token-env shortcut: after the first login the cached session makes reruns non-interactive, which is the only "unattended" mode we support.

### Reader identity ("comment in place", SLIMS-66)

`@hedgerow/reader` gives a page **visitor** their own atproto OAuth session in the browser, so they can post a real reply without leaving the page. This is purely additive: the read path (`@hedgerow/comments`, `@hedgerow/react`'s `Comments.*`/`Likes.*`) stays zero-auth exactly as before — a site that only wants to *display* comments pulls in none of this.

- **`@atproto/oauth-client-browser` is the client**, not `oauth-client-node` — a browser SPA has no backend to hold a session, so the session (and PKCE/DPoP state) lives in the browser's IndexedDB via that library, per-origin. There is no cross-site single sign-on: logging in on one Hedgerow-powered domain doesn't carry over to another.
- **Same client-id duality as publishing, browser-shaped.** Local dev on a loopback origin (`127.0.0.1`/`[::1]`) omits `clientId` entirely and the library derives the loopback client id from `window.location`. A real deployment passes `clientId` pointing at a hosted `client-metadata.json` (an example lives at `apps/demo/public/oauth/client-metadata.json`) — the URL itself *is* the client id, fetched via `BrowserOAuthClient.load()`.
- **Two DI seams keep it testable.** `createReader({ createClient, createAgent })` lets tests substitute both the OAuth client and the `@atproto/api` `Agent`, so the unit suite (`packages/reader/test/reader.test.ts`) never touches WebCrypto, IndexedDB, or the network — mirroring how `oauthPublisher`'s restore path is unit-tested while its browser dance is manual (see Testing pyramid below).
- **v1 replies only, root-targeted.** `createReply({ root, parent, text })` writes one `app.bsky.feed.post` with a `reply` ref straight to the reader's own PDS via `Agent.post`; the demo only offers replying to the root post (`root` and `parent` are the same strongRef), not to an arbitrary nested comment.
- **Signup is `prompt: "create"`, not an external link.** `signUp(service?)` starts the same OAuth redirect as `signIn()` but with atproto's `prompt: "create"` param and a service URL (default `https://bsky.social`) instead of a handle — the reader creates their account on the authorization server mid-flow and lands back on the page already authorized. No "go create an account on bsky.app, then come back and log in" round trip; the demo keeps a plain bsky.app link only as a tiny secondary fallback.
- **Consent is always shown, server-side — not something this package controls.** `@atproto/oauth-provider` forces a consent screen for any public client (`token_endpoint_auth_method: "none"`, which is what a browser SPA is) and rejects a silent (`prompt: "none"`) authorization outright; `prompt: "create"` is the one value it exempts from that gate, which is what makes `signUp()`'s no-extra-step landing work. So `signIn()`/`signUp()` never claim to be silent — the only silent path is `restore()` resuming an already-cached per-origin session. Demo copy and docs should say "you'll approve access on your Bluesky server," not imply an instant or cross-visit-silent login.

## Record-shape decisions

These are inherited from the prototype and encoded in `packages/publish/src/types.ts` and `records.ts`.

- **`textContent` (plaintext) is the portable body.** The `site.standard.document` lexicon's `content` field is an open union with **no members in the current version**, so there is no rich body type to write into a record yet. Hedgerow therefore derives a plaintext mirror (`toPlainText`) as the always-renderable body and **keeps the rich markdown in-repo** for local rendering. When the lexicon gains a content member, that becomes the place for rich content; until then, plaintext is what every consumer can trust.
- **TID rkeys are persisted in publish state.** `publishSite` records the record key it used per slug (and for the singleton publication) in `PublishState`. Persisting that state (e.g. `.publish-state.json`) is what makes reruns idempotent — the same post targets the same record instead of creating a duplicate.
- **`updatedAt` is stamped only on real changes.** Republishing compares the new record against the existing one *ignoring* `updatedAt`; if nothing else changed, the write is skipped entirely and `updatedAt` does not move. It advances only when the content actually changed, so it stays an honest "last edited" signal rather than a "last ran the script" timestamp.
- **`bskyPostRef` is the comment anchor.** A `strongRef` on the document points at a **real Bluesky post** that hosts the canonical thread. The document record is not itself the comment target — the conversation lives on Bluesky, and the record just names which post to read replies and likes from. This is what lets the read side render a live thread against a post the author actually made.

## Testing pyramid

Three automated tiers plus a manual gate for the parts that need the real network:

1. **Unit — pure transforms.** `records.test.ts` covers `parsePost`, `toPlainText`, and the record builders. No I/O, fast, the bulk of the coverage. `lexicon-validation.test.ts` additionally validates every record our builders produce against the **vendored lexicon JSON** (via `@atproto/lexicon`) — the drift guard that lets us keep hand-written narrow types instead of full codegen. (Note: the vendored docs carry an extra top-level `$type: "com.atproto.lexicon.schema"` key from how they're stored in the authority's repo; `@atproto/lexicon`'s parser currently ignores unknown keys, but if it ever turns strict, loading will fail here first.)
2. **Integration — in-process-PDS round trip.** `roundtrip.test.ts` boots a real PDS in-process via `@atproto/dev-env`, publishes, and reads back — exercising the whole write path (auth surface, upsert, idempotency, `updatedAt` semantics) with no credentials, Docker, or domain.
3. **Fixtures — AppView reads + an opt-in live smoke.** The comments read side is tested against recorded AppView fixtures for determinism, plus an opt-in live smoke suite (`LIVE_SMOKE=1`) against the real `public.api.bsky.app` to catch upstream drift.
4. **Manual go-live checklist.** OAuth login, custom-domain handle resolution, and Bluesky share-preview crawling depend on live third parties and a browser; they are verified by hand before a real launch rather than in CI. `@hedgerow/reader`'s real `BrowserOAuthClient`/`Agent` wiring (`default-client.ts`) is in this bucket too — its DI-injected engine (`reader.ts`) is unit tested, the actual login redirect isn't.
