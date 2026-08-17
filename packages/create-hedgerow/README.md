# create-hedgerow

Create a complete Astro publication whose public source of truth is the
author's AT Protocol repository.

Requires Node 22.12 or newer.

```bash
npm create hedgerow@latest my-site
```

The setup asks for an immutable author DID, canonical URL, and publication
name. It generates source you own:

- server-rendered article routes that read `site.standard.*` records;
- public Bluesky comments, like counts, and reply links on discussed articles;
- a local-first `/sudo` editor with TipTap, IndexedDB recovery, preview, diff,
  discard, Markdown import/export, and explicit publish;
- browser OAuth metadata and callback routes with author-only permissions;
- a one-time publication bootstrap script;
- Standard.site publication/document verification links.

Run non-interactively in CI or tests:

```bash
npx create-hedgerow my-site \
  --author did:plc:example \
  --url https://example.com \
  --name "Example" \
  --no-install
```

`--dry-run` writes nothing. A non-empty target is rejected unless `--force`
is supplied; force overwrites only matching generated files and never deletes
unrelated files.

The generated editor is application source, not an opaque runtime package.
Its marker records the generator version, but there is deliberately no promise
of automatic merges after you customise it. Protocol/auth fixes remain
upgradeable through `hedgerow`; product and visual decisions remain yours.

Drafts are unencrypted and device-local. The generated app requests persistent
browser storage, detects cross-tab draft races, and includes Markdown export,
but browser storage is not a backup. Published pages render article content on
the server from a short PDS cache; the client only hydrates the social thread
and authoring routes.

Pre-1.0, ESM-only. [MIT](./LICENSE).
