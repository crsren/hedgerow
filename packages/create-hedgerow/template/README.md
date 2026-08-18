# Hedgerow site

An Astro publication backed by the author's AT Protocol repository, generated
with create-hedgerow __HEDGEROW_GENERATOR_VERSION__.

## First run

```bash
__HEDGEROW_PACKAGE_MANAGER__ run hedgerow:bootstrap
__HEDGEROW_PACKAGE_MANAGER__ run dev
```

The bootstrap command opens AT Protocol OAuth, creates the
`site.standard.publication` record, and updates `.hedgerow/state.json`. Commit
that state file: its stable record keys keep later sync operations idempotent.
Then open `/sudo` to write and publish articles.

## Where data lives

- Published articles are `site.standard.document` records in the author's PDS.
- Unpublished drafts are unencrypted, device-local IndexedDB records under
  this site's origin. Export important drafts and do not treat browser storage
  as a backup.
- Comments and likes are public Bluesky records. Reading them is anonymous;
  replying or liking requires a Bluesky account. The starter links readers to
  Bluesky for writes and can be extended with `hedgerow/social` for in-place
  actions.

The server reads article records from the PDS and lets the framework/host cache
the rendered page; the browser does not fetch article bodies after page load.
Publishing verifies the new CID against the PDS before refreshing that cache.

## What to customise

The files under `src/components`, the TipTap extensions, draft policy, URL
layout, Markdown rendering, styles and deployment cache policy are application
source you own. Protocol record construction, conditional writes, OAuth and
public PDS reads stay upgradeable through the `hedgerow` dependency.

Keep the generated CSP (especially `frame-ancestors 'none'`) strict if the
editor shares an origin with the public site. A dedicated editor subdomain is
the stronger isolation boundary, but it intentionally has a separate OAuth
session and draft store.
