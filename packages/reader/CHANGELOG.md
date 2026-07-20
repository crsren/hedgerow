# @hedgerow/reader

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
