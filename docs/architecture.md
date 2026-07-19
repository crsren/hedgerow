# Architecture

Design notes for the Hedgerow monorepo. Kept brief; the source is the source of truth.

## Package dependency rules

The two halves of the toolkit — writing records and reading the social layer — stay decoupled.

- **The read side must never depend on the publish side.** A site that only renders comments and likes should pull in none of `@hedgerow/publish`'s write path (OAuth login, `@atproto/api` agents, markdown parsing). Read and write are separate concerns with separate blast radii.
- **The comments core is framework-agnostic.** `@hedgerow/comments` (planned) does the reading — resolve a post, page its replies and likes off the AppView, shape them into a tree — with no React, no DOM, no framework import.
- **`@hedgerow/react` and `@hedgerow/embed` are thin wrappers over that core.** They own rendering and interaction only; every fetch/transform decision lives in the core, so all surfaces stay behaviourally identical. React components follow Base UI principles (headless, unstyled, composable). The embed web component is a later wrapper over the same core.

## Auth

Publishing authenticates through one pluggable seam — the `Publisher` interface (`did` + `putRecord`/`getRecord`/`deleteRecord`) in `auth.ts`. `agentPublisher` adapts any `@atproto/api` `Agent` to it, so the same three methods back both the in-process test agent and a real OAuth session.

- **atproto OAuth is the only auth path.** `oauthPublisher` (`oauth.ts`) is the single way to authenticate a real publish — there is no credential- or token-based alternative. It restores a cached session if one exists, otherwise runs the login and persists the result.
- **CLI login is the loopback (native) flow.** atproto defines a client id of the form `http://localhost?scope=…&redirect_uri=…` for local clients — the authorization server synthesises the client metadata from that id, so there's no hosted client-metadata document and no client secret. We stand up a throwaway HTTP server on `127.0.0.1:<port>`, open the browser to the authorization URL, and catch the redirect there. The session (and transient auth state) persist through a small JSON file store (`store.ts`, default `~/.config/hedgerow`), and tokens refresh silently on restore.
- **A browser OAuth flow comes later for the prepared app.** The same `Publisher` seam will front an in-app browser OAuth login (hosted client metadata) when the packaged app ships; only the client-metadata source and the redirect handling change, not `publishSite`.
- **No headless publish path — by design.** A record write always requires a human to complete the browser login once. There is intentionally no username/password or token-env shortcut: after the first login the cached session makes reruns non-interactive, which is the only "unattended" mode we support.

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
3. **Fixtures — AppView reads + a scheduled live smoke.** The comments read side (planned) is tested against recorded AppView fixtures for determinism, with one scheduled live smoke test against the real `api.bsky.app` to catch upstream drift.
4. **Manual go-live checklist.** OAuth login, custom-domain handle resolution, and Bluesky share-preview crawling depend on live third parties and a browser; they are verified by hand before a real launch rather than in CI.
