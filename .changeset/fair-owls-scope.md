---
"hedgerow": minor
"@hedgerow/publish": minor
"@hedgerow/reader": minor
---

Introduce the curated `hedgerow/browser`, `hedgerow/site`,
`hedgerow/social`, and `hedgerow/node` entry points. Browser OAuth is now a
persona-neutral identity lifecycle with token-scope reporting; social and
site features export granular permission requests and bind sessions to
constrained actions. Site authors are pinned to one owner and publication,
while the Node sync path now requests only publication, document, profile and
discussion-post permissions. `@hedgerow/publish/site` provides the same
browser-safe protocol seam without pulling frontmatter parsing into client
bundles. `Reader.asPublisher()` remains available but is deprecated as
compatibility plumbing.
