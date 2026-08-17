# Architecture

Design notes for the Hedgerow monorepo. Kept brief; the source is the source of truth.

## Package dependency rules

Protocol packages stay decoupled; the `hedgerow` facade composes them into the
four concepts an adopter sees: browser identity, site authoring, social
conversation and Node synchronisation.

- **OAuth is identity, not a persona.** `createBrowser()` owns only restore,
  sign-in/up, sign-out, profile and callback state. It defaults to identity-only.
  `hedgerow/site` and `hedgerow/social` export the granular scope and bind a
  session to constrained feature operations.
- **The OAuth grant is the security boundary.** Capability wrappers prevent
  accidental arbitrary record writes, but only the PDS-enforced permission
  scope constrains a compromised browser. Hosted client metadata declares the
  maximum; each flow requests only its needed subset.

- **The read side must never depend on the publish side.** A site that only renders comments and likes should pull in none of `@hedgerow/publish`'s write path (OAuth login, `@atproto/api` agents, markdown parsing). Read and write are separate concerns with separate blast radii.
- **The comments core is framework-agnostic.** `@hedgerow/comments` does the reading — resolve a post, page its replies and likes off the AppView, shape them into a tree — with no React, no DOM, no framework import.
- **Renderers are thin wrappers over that core.** `@hedgerow/react` owns rendering and interaction only; every fetch/transform decision lives in the core, so all surfaces stay behaviourally identical. React components follow Base UI principles (headless, unstyled, composable). The `@hedgerow/embed` web component (planned) will be a later wrapper over the same core.
- **`@hedgerow/react` must never depend on `@hedgerow/reader`.** The `Reply.*` parts (SLIMS-66) take `session` and `onSubmit` as plain props — reader identity is entirely injected, never imported. This keeps the render layer usable with any atproto OAuth client, a server-backed auth of your own, or no reply composer at all. The **demo app** is what composes the two: `apps/demo/src/components/CommentThread.tsx` imports both `@hedgerow/react` and `@hedgerow/reader` and wires `createReader()`'s session/`createReply` into `Reply.Root`. The `Editor.*` parts (SLIMS-64) follow the exact same rule: `Editor.Root` takes `document`/`onSave` as plain props, so `@hedgerow/react` has no dependency on `@hedgerow/publish`, `@hedgerow/reader`, or any editor library — see below.
- **`@hedgerow/react` never ships an editor.** `Editor.Body` (SLIMS-64) is a headless SLOT: by default it's a plain `<textarea>` bound to the markdown string, and its `render` prop hands back `{ value, onChange }` for that string (not this library's usual DOM-props-merge `render` contract — a real editor component has nothing to do with spread DOM attributes). The demo mounts Tiptap (`@tiptap/react` + `@tiptap/starter-kit` + `tiptap-markdown`) into that slot as **app-land dependencies only** (`apps/demo/package.json`) — they must never become a dependency of `@hedgerow/react` itself.
- **`@hedgerow/publish`'s browser-focused site API vs. compatibility/Node APIs.** `@hedgerow/publish/site` contains record shapes/builders, public publication reads and CID-safe document operations without the frontmatter parser or Node OAuth dependencies. The top-level `"."` export remains the legacy all-purpose compatibility surface, including `gray-matter` parsing and reconciliation. `oauthPublisher`/`openInBrowser`/`clearSession` (`oauth.ts`, Node-only: `node:http`/`node:child_process`) and `FileStore` (`store.ts`, `node:fs`) live under `"./node"`. New applications normally consume `hedgerow/site`; lower-level browser code may use `@hedgerow/publish/site`, and Node scripts use `hedgerow/node` or `@hedgerow/publish/node`.
- **`Reader.asPublisher()` is compatibility plumbing, not product API.** The
  curated path is `site.author(session, { ownerDid, publicationUri })`, which
  verifies account/publication ownership, injects membership and exposes only
  create/update/delete/discussion operations. The raw adapter remains while
  existing consumers migrate.

## Auth

Two identities commonly write to atproto here: the site author and a visitor.
The browser OAuth lifecycle is shared and neutral; feature capabilities and
their permission scopes differ. Node publishing uses the native loopback OAuth
client because it runs in a different environment.

### Publishing (the author)

Publishing authenticates through one pluggable seam in `packages/publish/src/auth.ts`. `Publisher` preserves the original value-only contract for compatibility; `ConditionalPublisher` adds CID reads and AT Protocol `swapRecord` writes. `agentPublisher` returns the conditional surface for both the in-process test agent and a real OAuth session. New single-document operations require it, so stale tabs cannot silently overwrite or delete a newer record.

- **atproto OAuth is the only auth path.** `oauthPublisher` (`oauth.ts`) is the single way to authenticate a real publish — there is no credential- or token-based alternative. It restores a cached session if one exists, otherwise runs the login and persists the result.
- **CLI login is the loopback (native) flow.** atproto defines a client id of the form `http://localhost?scope=…&redirect_uri=…` for local clients — the authorization server synthesises the client metadata from that id, so there's no hosted client-metadata document and no client secret. We stand up a throwaway HTTP server on `127.0.0.1:<port>`, open the browser to the authorization URL, and catch the redirect there. The session (and transient auth state) persist through a small JSON file store (`store.ts`, default `~/.config/hedgerow`), and tokens refresh silently on restore.
- **No headless publish path — by design.** A record write always requires a human to complete the browser login once. There is intentionally no username/password or token-env shortcut: after the first login the cached session makes reruns non-interactive, which is the only "unattended" mode we support.

### Browser identity and social actions

`createBrowser()` gives a person an atproto OAuth session in the browser.
`social.actor(session)` then exposes replies and likes. Public thread and like
reads remain zero-auth; "anonymous" applies only to reading, never posting.

- **`@atproto/oauth-client-browser` is the client**, not `oauth-client-node` — a browser SPA has no backend to hold a session, so the session (and PKCE/DPoP state) lives in the browser's IndexedDB via that library, per-origin. There is no cross-site single sign-on: logging in on one Hedgerow-powered domain doesn't carry over to another.
- **Same client-id duality as publishing, browser-shaped.** Local dev on a loopback origin (`127.0.0.1`/`[::1]`) omits `clientId` entirely and the library derives the loopback client id from `window.location`. A real deployment passes `clientId` pointing at a hosted `client-metadata.json` (an example lives at `apps/demo/public/oauth/client-metadata.json`) — the URL itself *is* the client id, fetched via `BrowserOAuthClient.load()`.
- **Two DI seams keep it testable.** `createReader({ createClient, createAgent })` lets tests substitute both the OAuth client and the `@atproto/api` `Agent`, so the unit suite (`packages/reader/test/reader.test.ts`) never touches WebCrypto, IndexedDB, or the network — mirroring how `oauthPublisher`'s restore path is unit-tested while its browser dance is manual (see Testing pyramid below).
- **v1 replies only, root-targeted.** `createReply({ root, parent, text })` writes one `app.bsky.feed.post` with a `reply` ref straight to the reader's own PDS via `Agent.post`; the demo only offers replying to the root post (`root` and `parent` are the same strongRef), not to an arbitrary nested comment.
- **Signup is `prompt: "create"`, not an external link.** `signUp(service?)` starts the same OAuth redirect as `signIn()` but with atproto's `prompt: "create"` param and a service URL (default `https://bsky.social`) instead of a handle — the reader creates their account on the authorization server mid-flow and lands back on the page already authorized. No "go create an account on bsky.app, then come back and log in" round trip; the demo keeps a plain bsky.app link only as a tiny secondary fallback.
- **Consent is always shown, server-side — not something this package controls.** `@atproto/oauth-provider` forces a consent screen for any public client (`token_endpoint_auth_method: "none"`, which is what a browser SPA is) and rejects a silent (`prompt: "none"`) authorization outright; `prompt: "create"` is the one value it exempts from that gate, which is what makes `signUp()`'s no-extra-step landing work. So `signIn()`/`signUp()` never claim to be silent — the only silent path is `restore()` resuming an already-cached per-origin session. Demo copy and docs should say "you'll approve access on your Bluesky server," not imply an instant or cross-visit-silent login.

### Authoring identity

An editor requests `site.permissionScope`, restores a browser session and binds
it with `site.author(session, { ownerDid, publicationUri })`. A dedicated
author client id/route is recommended so a visitor's social grant never gains
site-write permissions merely because both features share an origin.

## Record-shape decisions

These are inherited from the prototype and encoded in `packages/publish/src/types.ts` and `records.ts`.

- **`textContent` (plaintext) is the always-renderable body; `content` (SLIMS-64) is the rich one.** The `site.standard.document` lexicon's `content` field is an open union (`closed: false`, no `refs` — any `$type`-tagged member validates structurally, see `@atproto/lexicon`'s `validateOneOf`). Hedgerow defines and vendors the one member it writes, `pub.hedgerow.content.markdown` (`packages/publish/lexicons/pub/hedgerow/content/markdown.json`, `{ $type, markdown: string, blobs?: blob[] }` — `blobs` unused in v1, reserved for pinning embedded images later). Every document record that carries `content` **always also** mirrors plaintext into `textContent` (`toPlainText`), so a plain standard.site reader with no knowledge of this member still renders something — `textContent` is what every consumer can trust; `content` is the upgrade. The file-based publish path (`records.ts`'s `documentRecord`) emits both from the same markdown source on every build. The demo's `/edit` route (below) is the other writer: it rebuilds `content`+`textContent` from the editor's markdown on save.
- **TID rkeys are persisted in publish state.** `publishSite` records the record key it used per slug (and for the singleton publication) in `PublishState`. Persisting that state (e.g. `.publish-state.json`) is what makes reruns idempotent — the same post targets the same record instead of creating a duplicate.
- **`updatedAt` is stamped only on real changes.** Republishing compares the new record against the existing one *ignoring* `updatedAt`; if nothing else changed, the write is skipped entirely and `updatedAt` does not move. It advances only when the content actually changed, so it stays an honest "last edited" signal rather than a "last ran the script" timestamp.
- **`bskyPostRef` is the comment anchor.** A `strongRef` on the document points at a **real Bluesky post** that hosts the canonical thread. The document record is not itself the comment target — the conversation lives on Bluesky, and the record just names which post to read replies and likes from. This is what lets the read side render a live thread against a post the author actually made.

## Testing pyramid

Three automated tiers plus a manual gate for the parts that need the real network:

1. **Unit — pure transforms.** `records.test.ts` covers `parsePost`, `toPlainText`, and the record builders. No I/O, fast, the bulk of the coverage. `lexicon-validation.test.ts` additionally validates every record our builders produce against the **vendored lexicon JSON** (via `@atproto/lexicon`) — the drift guard that lets us keep hand-written narrow types instead of full codegen. (Note: the vendored docs carry an extra top-level `$type: "com.atproto.lexicon.schema"` key from how they're stored in the authority's repo; `@atproto/lexicon`'s parser currently ignores unknown keys, but if it ever turns strict, loading will fail here first.)
2. **Integration — in-process-PDS round trip.** `roundtrip.test.ts` boots a real PDS in-process via `@atproto/dev-env`, publishes, and reads back — exercising the whole write path (auth surface, upsert, idempotency, `updatedAt` semantics) with no credentials, Docker, or domain.
3. **Fixtures — AppView reads + an opt-in live smoke.** The comments read side is tested against recorded AppView fixtures for determinism, plus an opt-in live smoke suite (`LIVE_SMOKE=1`) against the real `public.api.bsky.app` to catch upstream drift.
4. **Manual go-live checklist.** OAuth login, custom-domain handle resolution, and Bluesky share-preview crawling depend on live third parties and a browser; they are verified by hand before a real launch rather than in CI. `@hedgerow/reader`'s real `BrowserOAuthClient`/`Agent` wiring (`default-client.ts`) is in this bucket too — its DI-injected engine (`reader.ts`) is unit tested, the actual login redirect isn't.
