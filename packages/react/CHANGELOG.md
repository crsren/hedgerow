# @hedgerow/react

## 0.1.1

### Patch Changes

- [#14](https://github.com/crsren/hedgerow/pull/14) [`d071963`](https://github.com/crsren/hedgerow/commit/d071963578c821bff4a744da82ee2f6fc3de12b6) Thanks [@crsren](https://github.com/crsren)! - Stop emitting React's ref-slot warning, and actually support the React 19 half of the declared peer range.

  `renderElement` read both `element.props.ref` and `element.ref` when cloning a `render` element. Each React major turns the _other_ slot into a warning: React 18 logs "`ref` is not a prop" (this was firing in every consumer that used the element form of `render`), and React 19 logs "Accessing element.ref was removed". It now reads only the slot that is real for the running major.

  The package has always declared `react: ^18 || ^19` but was only ever built and tested against 18. Testing 19 surfaced three more type-level breaks, all now fixed: `onSubmit` (React 19 introduced a distinct `SubmitEvent` type), `cloneElement`'s tightened second parameter, and a callback ref whose return value React 19 reads as a cleanup function.

  No API change — the same components, props and types as before.

- Updated dependencies []:
  - @hedgerow/comments@0.1.1

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

### Patch Changes

- Updated dependencies
  - @hedgerow/comments@0.1.0
