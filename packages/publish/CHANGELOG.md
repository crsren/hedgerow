# @hedgerow/publish

## 0.2.0

### Minor Changes

- [#28](https://github.com/crsren/hedgerow/pull/28) [`9e9cd90`](https://github.com/crsren/hedgerow/commit/9e9cd90ce87806929470faa9d2a19c019311e8c9) Thanks [@crsren](https://github.com/crsren)! - Stamp published documents with tool attribution (`pub.hedgerow.via`)

  Every `site.standard.document` written by `publishSite` now carries an extra
  field, `"pub.hedgerow.via": "@hedgerow/publish"`, so a reader can tell
  hedgerow-published documents apart from any other standard.site producer.
  `VIA_KEY` and `VIA_VALUE` are exported to filter on without hardcoding strings.

  The field is not part of the standard.site lexicon. It rides along as an
  unknown field, which the protocol carries rather than strips — PDSes don't
  validate against lexicons, and the lexicon spec says consumers should ignore
  fields they don't recognise. Readers that don't know it are unaffected. The key
  is reverse-DNS rather than a bare `via` because atproto has no convention for
  third-party extra keys, and `via` is the name standard.site would most likely
  choose if it ever adds attribution of its own.

  **Upgrading rewrites your existing documents once.** `publishSite` decides
  whether to write by comparing the record it builds against the live one, so on
  the first publish after this upgrade every already-published document differs
  (it lacks the stamp) and is rewritten with `updatedAt` set to now — including
  posts you haven't touched. A site that displays "last updated" will show
  today's date on everything, once. Subsequent publishes are no-ops again: the
  stamp is a constant and deliberately carries no version, precisely so that
  upgrading hedgerow never churns records again.

  If that one-time bump matters for your site, publish once immediately after
  upgrading and before your next content change, so the two aren't conflated.

## 0.1.1

### Patch Changes

- [#24](https://github.com/crsren/hedgerow/pull/24) [`bf2b8f4`](https://github.com/crsren/hedgerow/commit/bf2b8f4347775936f5372acb400d3d7a6fe951cb) Thanks [@crsren](https://github.com/crsren)! - Align the `@atproto/api` range on `^0.20.31` across the packages that depend on it.

  `@hedgerow/publish` asked for `^0.20.0` while `@hedgerow/reader` asked for `^0.20.30`, which let a consumer's tree end up with two copies of the SDK — and `@atproto/api` carries the atproto identity and session types both packages exchange, so two copies is a real hazard rather than just wasted bytes.

  No API change. The new floor is a version already published inside the previously-declared range, so nothing that worked before stops working.

- [#13](https://github.com/crsren/hedgerow/pull/13) [`91c5644`](https://github.com/crsren/hedgerow/commit/91c564467787b5c395f7dd813ee0c35144559d51) Thanks [@crsren](https://github.com/crsren)! - Declare `@atproto/common-web` at `^0.5.6`, matching what `@atproto/api` already requires.

  The old `^0.4.0` range meant every consumer installed **two** copies of the package: 0.4.21 for this direct dependency and 0.5.6 pulled in by `@atproto/api`. Now there is one.

  Record key generation is unchanged. `TID` output was compared across both versions over 200 generated keys with zero differences, and 0.5.6 parses keys produced by 0.4.21 — so existing `.publish-state.json` files stay valid and republishing remains idempotent against records already in your repo.

  No API change, and no new constraint on consumers: the ESM-only, Node >= 22 floor that 0.5 introduces was already imposed by the existing `@atproto/api` dependency.

## 0.1.0

### Minor Changes

- First public release. Give any website a social layer on the AT Protocol:

  - `@hedgerow/publish` — publish posts as `site.standard.*` records to your own
    PDS (markdown in, records out, OAuth login, share-post anchors, prune/unshare),
    with a browser-safe core and a `/node` entry for CLI use.
  - `@hedgerow/comments` — zero-dependency isomorphic read core: live Bluesky
    comment threads and likes for any post, deleted/blocked stubs that never
    crash, injectable fetch.
  - `@hedgerow/react` — fully headless React parts in the Base UI idiom
    (`Comments.*`, `Likes.*`, `Reply.*`, `Editor.*`): render props, `data-*`
    state attributes, optimistic replies with delivery states, SSR seeding,
    controlled-data mode for external data layers, and zero auth dependencies —
    sessions and writes are injected.
  - `@hedgerow/reader` — browser OAuth for readers: sign in with any atproto
    account (or sign up mid-flow), reply, like, and edit your own records, with
    OAuth `state` round-tripping for intent that survives the redirect.
