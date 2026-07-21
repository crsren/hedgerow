# Hedgerow

An open-source toolkit that gives a personal website a social layer, built on the [AT Protocol](https://atproto.com).

Three parts:

- **Publish** your posts as portable `site.standard.*` records in your own atproto repo — your writing lives on the open network, not locked inside one host's database.
- **Render** live Bluesky comments and likes directly on your own site, so the conversation about a post happens where people already are, but shows up where you own it.
- **Reply in place** — a visitor signs into their own Bluesky account on your page and posts a real reply from their own repo, without a round trip to bsky.app.

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
│   ├── reader/          @hedgerow/reader — browser OAuth identity for a page visitor, so they can reply in place
│   ├── embed/           @hedgerow/embed — drop-in web component for non-React sites                     (planned)
│   └── astro/           @hedgerow/astro — Astro integration                                             (planned)
└── tooling/
    └── tsconfig/        @hedgerow/tsconfig — shared TypeScript configs
```

Managed with pnpm workspaces, [Turborepo](https://turbo.build), and [Changesets](https://github.com/changesets/changesets). ESM-only.

The four published packages split along two axes: **who is acting** (the author, a visitor, or nobody) and **what it costs your bundle**.

| Package | Runs | Needs auth | Depends on |
| --- | --- | --- | --- |
| `@hedgerow/comments` | anywhere | no | nothing at all |
| `@hedgerow/react` | React app | no | `@hedgerow/comments`, React as a peer |
| `@hedgerow/reader` | browser | visitor's own OAuth | `@atproto/api`, `@atproto/oauth-client-browser` |
| `@hedgerow/publish` | Node (core is isomorphic) | author's own OAuth | `@atproto/api`, `gray-matter`, Node OAuth client |

Reading a public thread needs no identity, so `@hedgerow/comments` carries no dependencies and `@hedgerow/react` adds only React. Replying does need identity, so it lives in `@hedgerow/reader` — a site that only *displays* comments never pulls in an OAuth client for a login button its visitors may never press.

The seam that keeps that true: **`@hedgerow/react` never imports `@hedgerow/reader`.** The `Reply.*` parts take `session` and `onSubmit` as plain props, so reader identity is injected rather than baked in, and the render layer works just as well against your own server-backed auth or with no reply composer at all. `Editor.*` follows the same rule for `@hedgerow/publish`. The demo app is what composes them — see [`docs/architecture.md`](./docs/architecture.md) for the full dependency rules.

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

- **OAuth login** — publishing authenticates with atproto OAuth via the loopback flow (the shipped and only auth path). It needs a real browser and PDS, so it's exercised by hand, not in CI.
- **Custom-domain handles** — resolving `you.com` → DID → PDS hits live DNS, the Bluesky handle resolver, and `plc.directory`.
- **Bluesky share-preview crawling** — how a shared post's link unfurls depends on Bluesky's own crawler and cache.

## Publishing for real

The round-trip tests never touch your account. To publish to your actual repo, authenticate with **atproto OAuth** — there's no password or credential to store. The first publish opens a browser for you to log in; the session is then cached (in `~/.config/hedgerow`) and reused, refreshing itself silently, until you sign out.

```ts
import { oauthPublisher, publishSite, parsePost } from "@hedgerow/publish";

// Restores a cached session, or runs the browser login the first time.
// `identifier` (a handle or DID) is an optional hint — omit it to pick the
// account in the browser.
const publisher = await oauthPublisher({ identifier: "you.bsky.social" });

const posts = [parsePost(markdown, "my-first-post")];
const result = await publishSite(
  publisher,
  { url: "https://you.com", name: "you" },
  posts,
);
```

The login uses the atproto **loopback client** flow: a native client id (`http://localhost?...`) with a throwaway callback server on `127.0.0.1`. Nothing to host, no client secret. Sign out (clear the cached session) with `clearSession()` (aliased `logout()`); pass `{ identifier }` to drop just one account.

Because a record write requires a real login, there is deliberately **no headless publish path** — a human completes the browser step once, then reruns are non-interactive off the cached session.

Persist `result.state` between runs so reruns reuse the same record keys and skip unchanged writes. Verify what landed in your repo at [pdsls.dev](https://pdsls.dev).

The demo wraps all of this: `pnpm --filter @hedgerow/demo run publish:pds` (set `ATP_IDENTIFIER` to hint the account; add `--print-auth-url` to print the login URL instead of opening a browser).

## Rendering the social layer

Each read-side package documents its own surface:

- [`@hedgerow/comments`](./packages/comments) — the framework-agnostic core, if you're rendering the thread yourself or wrapping it for another framework.
- [`@hedgerow/react`](./packages/react) — the headless `Comments.*`, `Likes.*`, `Reply.*` and `Editor.*` parts, plus guidance on auth-on-demand, optimistic replies, SSR seeding, entry/exit animation, and rendering many threads on one index page.
- [`@hedgerow/reader`](./packages/reader) — browser OAuth for a visitor, client-id setup for local dev vs. a real deployment, and `createReply()`.

`apps/demo` wires all three together: `apps/demo/src/components/CommentThread.tsx` is the reference for feeding a `@hedgerow/reader` session into `@hedgerow/react`'s `Reply.Root`.

## License

[MIT](./LICENSE)
