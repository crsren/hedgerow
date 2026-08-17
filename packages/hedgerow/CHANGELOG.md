# hedgerow

## 0.1.0

### Minor Changes

- [#35](https://github.com/crsren/hedgerow/pull/35) [`643e722`](https://github.com/crsren/hedgerow/commit/643e7222a8dee243382bd3281557eb10d086648f) Thanks [@crsren](https://github.com/crsren)! - Introduce the curated `hedgerow/browser`, `hedgerow/site`,
  `hedgerow/social`, and `hedgerow/node` entry points. Browser OAuth is now a
  persona-neutral identity lifecycle with token-scope reporting; social and
  site features export granular permission requests and bind sessions to
  constrained actions. Site authors are pinned to one owner and publication,
  while the Node sync path now requests only publication, document, profile and
  discussion-post permissions. `@hedgerow/publish/site` provides the same
  browser-safe protocol seam without pulling frontmatter parsing into client
  bundles. `Reader.asPublisher()` remains available but is deprecated as
  compatibility plumbing.

### Patch Changes

- Updated dependencies [[`247cbf3`](https://github.com/crsren/hedgerow/commit/247cbf39c64af3b0d7fe3007a678022735b50608), [`643e722`](https://github.com/crsren/hedgerow/commit/643e7222a8dee243382bd3281557eb10d086648f)]:
  - @hedgerow/comments@0.3.0
  - @hedgerow/reader@0.3.0
  - @hedgerow/publish@0.3.0

## 0.0.1

Reserved package name. The first supported release is managed by Changesets.
