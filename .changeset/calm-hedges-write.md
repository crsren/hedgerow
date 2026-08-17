---
"@hedgerow/comments": minor
"@hedgerow/react": minor
"@hedgerow/reader": minor
"@hedgerow/publish": minor
---

Add conflict-safe document authoring and publication-scoped reads. Document
and publication reads now retain record CIDs; browser and Node publisher
adapters support `swapRecord`; and new `createDocument`, `updateDocument`,
`deleteDocument`, and `startDiscussion` operations own TID generation, record
construction, and rollback. `readSite` now requires an explicit publication
scope when a repository contains multiple publications, and rich content is
typed as an open union: use `isMarkdownContent` or `documentMarkdown` before
editing instead of accessing `content.markdown` directly.
