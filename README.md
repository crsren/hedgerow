# Hedgerow

An open-source toolkit that gives a personal website a social layer, built on the [AT Protocol](https://atproto.com).

Two halves:

- **Publish** your posts as portable `site.standard.*` records in your own atproto repo — your writing lives on the open network, not locked inside one host's database.
- **Render** live Bluesky comments and likes directly on your own site, so the conversation about a post happens where people already are, but shows up where you own it.

The thesis: AI has removed the effort of building a website. A static site is now a weekend, not a project. The one thing platforms still hold over a personal site is the social layer — the replies, the reach, the being-seen. Hedgerow moves that layer onto the open protocol, so the last reason to stay on a platform goes away.

## Repo layout

```
hedgerow/
├── apps/
│   └── demo/            Astro demo site — renders a site from atproto records
├── packages/
│   ├── publish/         @hedgerow/publish — markdown → site.standard.* records on a PDS, and read them back
│   ├── comments/        @hedgerow/comments — zero-dep read core: resolve a post, fetch + normalise its comments/likes
│   ├── react/           @hedgerow/react — headless React components and hooks over the comments core
│   ├── embed/           @hedgerow/embed — drop-in web component for non-React sites                     (planned)
│   └── astro/           @hedgerow/astro — Astro integration                                             (planned)
└── tooling/
    └── tsconfig/        @hedgerow/tsconfig — shared TypeScript configs
```

Managed with pnpm workspaces, [Turborepo](https://turbo.build), and [Changesets](https://github.com/changesets/changesets). ESM-only.

## Quickstart

Requires Node ≥ 20 and pnpm (the pinned version comes from the `packageManager` field — `corepack enable` will honour it).

```bash
pnpm install
pnpm build          # turbo build across the workspace
pnpm test           # unit + in-process-PDS round-trip tests
pnpm --filter @hedgerow/demo dev    # run the demo site
```

## The testing story

The whole publish path is testable with **zero external dependencies**. `@hedgerow/publish` runs its full `publish → PDS → read` loop against an in-process PDS from [`@atproto/dev-env`](https://github.com/bluesky-social/atproto/tree/main/packages/dev-env) — no credentials, no Docker, no domain, no live account. The test boots a real PDS in-process, creates an account, publishes records, and reads them back to assert fidelity and idempotency. This is the boundary worth knowing: everything up to and including a real repo write is exercised locally on every `pnpm test`.

What genuinely needs the real world, and so lives in manual checklists rather than the automated suite:

- **OAuth** — the app-password path is covered; the atproto OAuth login flow needs a real browser and PDS.
- **Custom-domain handles** — resolving `you.com` → DID → PDS hits live DNS, the Bluesky handle resolver, and `plc.directory`.
- **Bluesky share-preview crawling** — how a shared post's link unfurls depends on Bluesky's own crawler and cache.

## Publishing for real

The round-trip tests never touch your account. To publish to your actual repo, authenticate with an **app password** (Bluesky → Settings → App Passwords) — **never your account password**:

```bash
export ATP_IDENTIFIER="you.bsky.social"   # or your custom-domain handle
export ATP_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
```

```ts
import { appPasswordPublisher, publishSite, parsePost } from "@hedgerow/publish";

const publisher = await appPasswordPublisher({
  identifier: process.env.ATP_IDENTIFIER!,
  password: process.env.ATP_APP_PASSWORD!,
});

const posts = [parsePost(markdown, "my-first-post")];
const result = await publishSite(
  publisher,
  { url: "https://you.com", name: "you" },
  posts,
);
```

Persist `result.state` between runs so reruns reuse the same record keys and skip unchanged writes. Verify what landed in your repo at [pdsls.dev](https://pdsls.dev).

## License

[MIT](./LICENSE)
