# @hedgerow/publish

Publish markdown posts as portable [`site.standard.*`](https://standard.site)
records in your own [AT Protocol](https://atproto.com) repository, and read them
back. Your writing lives on the open network in a repo you control, rather than
inside one host's database.

Part of [Hedgerow](https://github.com/crsren/hedgerow). This is the **author's**
side of the toolkit — see [`@hedgerow/comments`](../comments) and
[`@hedgerow/react`](../react) for rendering the social layer on your site, and
[`@hedgerow/reader`](../reader) for a visitor's own identity.

## Install

```bash
npm install @hedgerow/publish
```

Node ≥ 20. ESM-only.

## Two entry points

This package splits deliberately, because half of it must be safe to bundle for
a browser:

| Import | Contains | Safe in a browser |
| --- | --- | --- |
| `@hedgerow/publish` | Record shapes, `parsePost`, `documentRecord`, `toPlainText`, `publishSite`'s upsert logic, and the unauthenticated read path | **Yes** |
| `@hedgerow/publish/node` | The above, plus `oauthPublisher`, `openInBrowser`, `clearSession`, and `FileStore` | No — uses `node:http`, `node:fs` |

A Node script or CLI should import `@hedgerow/publish/node` to get everything
through one import. A browser bundle must import the bare `@hedgerow/publish`,
which never touches a Node builtin.

## Publishing

Authentication is **atproto OAuth** — there is no password or app-password to
store. The first publish opens a browser; the session is then cached (in
`~/.config/hedgerow`) and silently refreshed until you sign out.

```ts
import { oauthPublisher, publishSite, parsePost } from "@hedgerow/publish/node";

// Restores a cached session, or runs the browser login the first time.
// `identifier` is an optional hint — omit it to pick the account in the browser.
const publisher = await oauthPublisher({ identifier: "you.bsky.social" });

const posts = [parsePost(markdown, "my-first-post")];
const result = await publishSite(
  publisher,
  { url: "https://you.com", name: "you" },
  posts,
);
```

Login uses the atproto **loopback client** flow: a native client id and a
throwaway callback server on `127.0.0.1`. Nothing to host, no client secret.
Because a record write requires a real login, there is deliberately **no
headless publish path** — a human completes the browser step once, then reruns
are non-interactive off the cached session.

Sign out with `clearSession()` (aliased `logout()`); pass `{ identifier }` to
drop just one account.

### Persist the state, or you'll create duplicates

`publishSite` returns a `PublishState` recording which record key it used per
slug. **Persist it between runs** (e.g. `.publish-state.json`) — that is what
makes reruns idempotent, targeting the same record instead of creating a second
one.

```ts
import { readFile, writeFile } from "node:fs/promises";
import { emptyState } from "@hedgerow/publish/node";

const state = await readFile(".publish-state.json", "utf8")
  .then(JSON.parse)
  .catch(() => emptyState());

const result = await publishSite(publisher, config, posts, state);

await writeFile(".publish-state.json", JSON.stringify(result.state, null, 2));
```

Reading it back in is the half that matters — `publishSite` without a `state`
argument starts from empty and will create a second record for every post.

Two related behaviours worth knowing:

- **`updatedAt` only moves on a real change.** Republishing compares against the
  existing record ignoring `updatedAt`; if nothing else changed, the write is
  skipped entirely. It stays an honest "last edited", not "last ran the script".
- **`textContent` is always written.** Every document mirrors plaintext into
  `textContent` alongside the richer `content`, so a standard.site reader that
  knows nothing about Hedgerow's markdown member still renders something.

Verify what landed in your repo at [pdsls.dev](https://pdsls.dev).

## Connecting a post to its comments

`bskyPostRef` is a `strongRef` on the document pointing at a real Bluesky post
that hosts the canonical thread. The document record is not itself the comment
target — the conversation lives on Bluesky, and the record names which post to
read replies and likes from. That is what lets `@hedgerow/comments` render a
live thread against a post you actually made.

## Testing

The full `publish → PDS → read` loop is tested against an **in-process PDS**
from [`@atproto/dev-env`](https://github.com/bluesky-social/atproto/tree/main/packages/dev-env)
— no credentials, no Docker, no domain, no live account. What genuinely needs
the real world (OAuth login, custom-domain handle resolution) lives in a manual
checklist instead. See the [repo README](../../README.md#the-testing-story).

## Stability

Pre-1.0. While this package is on `0.x`, a **minor** version bump may contain
breaking changes — npm resolves `^0.1.0` as `>=0.1.0 <0.2.0`, so a caret range
is already safe. Pin exactly (`0.1.0`) or use `~0.1.0` if you want to be
conservative. See [CONTRIBUTING.md](../../CONTRIBUTING.md#choosing-the-version-bump).

## License

[MIT](./LICENSE)
