# @hedgerow/comments

The framework-agnostic read core behind Hedgerow's comments. It resolves a Bluesky post reference, fetches its reply thread and likes off the public AppView, and normalises the raw lexicon into clean, stable shapes a renderer can consume. Zero dependencies, isomorphic (browser or server), ESM-only. No auth — it reads the public, unauthenticated AppView (`https://public.api.bsky.app`).

If you're building UI, you probably want [`@hedgerow/react`](../react), which wraps this in headless components and hooks. Reach for this package directly when you're on another framework, doing SSR/build-time seeding, or want the normalised data without any React.

## Install

```bash
npm install @hedgerow/comments
```

## What it does

- **Resolve** any of the ways a post gets referenced into one canonical `at://` URI that carries a DID.
- **Fetch + normalise** the thread (`getPostThread`) into a recursive `CommentNode` tree, and the likes (`getLikes`) into a flat actor list.
- **Never crash on gaps.** Deleted and blocked replies become explicit placeholder nodes, not exceptions. Moderation labels are surfaced on every node, never auto-hidden.

It does *not* sort implicitly, hide anything, or make policy decisions — those are the renderer's call.

## API

### `resolvePostUri(input, opts?): Promise<string>`

Normalises any supported reference to a canonical `at://did:…/app.bsky.feed.post/rkey` URI. Accepts:

- `at://did:plc:…/app.bsky.feed.post/rkey` — passed through, no network call
- `at://handle/app.bsky.feed.post/rkey` — resolves the handle → DID (one memoised call)
- `https://bsky.app/profile/{handleOrDid}/post/{rkey}` — parsed, then resolved as above

```ts
import { resolvePostUri } from "@hedgerow/comments";
const uri = await resolvePostUri("https://bsky.app/profile/jay.bsky.team/post/3l6…");
```

Companion helper `atUriToBskyUrl(atUri): string` builds the `bsky.app` web URL (the "view/reply on Bluesky" link) from a post `at://` URI.

### `fetchThread(input, opts?): Promise<ThreadResult>`

Resolves `input`, calls `app.bsky.feed.getPostThread`, and returns the normalised tree.

```ts
interface FetchThreadOpts {
  maxDepth?: number;      // reply depth to fetch AND keep (default 10, hard cap 1000)
  preResolved?: boolean;  // skip resolvePostUri when input is already a canonical at:// URI
  appView?: string;       // AppView base URL (default the public one)
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;    // handle→DID cache TTL (default 5 min; 0 disables)
}

interface ThreadResult {
  uri: string;         // canonical at:// URI of the root post
  post: CommentNode;   // root node with its reply tree (may itself be a stub)
  stats: PostStats;    // root-post engagement counts
  postUrl: string;     // bsky.app URL of the root post
}
```

Depth is enforced twice: it's passed to `getPostThread` as `depth`, and re-capped defensively during normalisation.

### `fetchLikes(input, opts?): Promise<LikesResult>`

Resolves `input` and pages `app.bsky.feed.getLikes` up to a cap.

```ts
interface FetchLikesOpts {
  pageSize?: number;      // actors per page (getLikes max 100, default 100)
  maxPages?: number;      // page cap (default 5 → up to 500 likes)
  preResolved?: boolean;
  appView?: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
}

interface LikesResult {
  uri: string;
  likes: Like[];
  total: number;          // number COLLECTED (capped), not the post's full likeCount
  cursor?: string;        // set only when more likes remain uncollected
}
```

`getLikes` gives no grand total, only pages of actors — so `total` is what was actually fetched (bounded by `pageSize × maxPages`), which can be fewer than the post's real like count. For the true count, read `stats.likeCount` from `fetchThread`.

### `sortReplies(nodes, order): CommentNode[]`

Pure, non-mutating reply ordering. Returns a new array with each comment's own `replies` recursively sorted the same way. `order` is `"newest" | "oldest" | "most-liked"` (the `SortOrder` type). Placeholder stubs have no timestamp or count, so they sort to the end with stable relative order.

```ts
import { fetchThread, sortReplies } from "@hedgerow/comments";
const { post } = await fetchThread(uri);
const ordered = post.type === "comment" ? sortReplies(post.replies, "most-liked") : [];
```

## The `CommentNode` union

A thread node is one of three shapes, discriminated on `type`. The two placeholders are what keep a render from crashing on a missing reply:

```ts
type CommentNode = Comment | NotFoundNode | BlockedNode;

interface Comment {
  type: "comment";
  uri: string;
  cid: string;
  author: Actor;                 // { did, handle, displayName?, avatar? }
  text: string;
  createdAt: string;             // ISO, from the post record
  indexedAt?: string;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  labels: Label[];               // post + author moderation labels, merged
  replies: CommentNode[];        // normalised, depth-capped
  url: string;                   // bsky.app web URL for this comment
}

interface NotFoundNode {         // a reply the AppView couldn't return (deleted / detached)
  type: "notFound";
  uri: string;
}

interface BlockedNode {          // a reply hidden by a block relationship
  type: "blocked";
  uri: string;
  authorDid?: string;
}
```

### Labels philosophy

Moderation `labels` (post-level and author-level, merged) are attached to every `Comment` and **never removed** by this core. Surfacing them is the library's job; deciding whether to badge, dim, or hide labelled content is entirely the consumer's — pass whatever the data down through your own filter. The core stays policy-free on purpose.

## Errors

Every failed AppView call throws a single typed error, `HedgerowFetchError`, so you can tell a deleted post from a dead network:

- `status` — HTTP status, or `0` when the request never completed
- `network` — `true` when `fetch` itself rejected (offline, DNS, CORS) — no HTTP response
- `xrpcError` / `xrpcMessage` — the parsed XRPC `error` / `message`, when the body had them
- `method` — the XRPC method that failed
- `isNotFound` — convenience getter: `true` on an explicit `NotFound` XRPC error or a 404

Note the distinction: a live thread whose *root* post is deleted comes back as a `notFound` **placeholder node**, not an error — the error path is for calls the AppView rejects outright.

## Caching & AppView courtesy

Handle → DID resolutions are memoised in a module-level `Map` with a short TTL (default 5 minutes; set `cacheTtlMs: 0` to disable, or call `clearHandleCache()` in tests). This handle cache is the only shared state; thread and likes responses are **not** cached.

The default AppView is Bluesky's public, unauthenticated one — a shared, rate-limited resource. Be a good citizen:

- **Don't hammer it.** Every mount of a component that calls `fetchThread`/`fetchLikes` is a live request. Avoid tight refetch loops.
- **Seed busy pages.** For anything with real traffic, fetch on your server or at build time and pass the result as `initialData` to the React components (or cache it yourself), rather than fetching from every visitor's browser.
- **Cap what you fetch.** Tune `maxDepth` (threads) and `maxPages` (likes) to what you'll actually render.

## Testing

The whole read path is exercised against captured AppView fixtures with an injectable `fetchImpl` — no network, no credentials. Pass your own `fetch` (a counting stub, a fixture server, a proxy) through any of the options above to test or redirect the calls.

## License

[MIT](../../LICENSE)
