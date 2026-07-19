# @hedgerow/react

Headless React components for showing live Bluesky comments and likes on your own site. Point a `<Comments.Root>` at one of your posts and its replies render on your page, reading straight from the public Bluesky AppView — no auth, no API key, no styles. Every part renders a plain default element and exposes its state through `className`/`style`/`render` functions and `data-*` attributes, so the markup and the look are entirely yours.

Built on [`@hedgerow/comments`](../comments), the zero-dependency read core. The `render` prop follows the [Base UI](https://base-ui.com) contract, so if you've used Base UI or Radix the composition model is the one you already know.

## Install

```bash
npm install @hedgerow/react
```

React is a peer dependency (`react-dom` is optional — you only need it in the browser):

```json
"peerDependencies": {
  "react": "^18.0.0 || ^19.0.0",
  "react-dom": "^18.0.0 || ^19.0.0"
}
```

For SSR/build-time seeding (see [Recipes](#recipes)) you'll also want the core directly:

```bash
npm install @hedgerow/comments
```

## Hero example

This works as-is. `post` accepts an `at://` URI **or** a `bsky.app` post URL; the components fetch, normalise, sort, and render the thread. All the class names are yours to style.

```tsx
import { Comments } from "@hedgerow/react";

export function CommentThread({ post }: { post: string }) {
  return (
    <Comments.Root className="comments" post={post} sort="newest">
      <Comments.Loading>Loading comments…</Comments.Loading>
      <Comments.Error>Couldn’t load comments right now.</Comments.Error>
      <Comments.Empty>No replies yet.</Comments.Empty>

      <Comments.List className="comment-list">
        <Comments.Item className="comment">
          {/* Renders only for deleted / blocked replies; real comments skip it. */}
          <Comments.Fallback className="comment-fallback" />

          <div className="comment-head">
            <Comments.Avatar className="comment-avatar" />
            <Comments.Author className="comment-author" />
            <Comments.Timestamp className="comment-time" />
            <Comments.Labels className="comment-labels" />
          </div>

          <Comments.Content className="comment-body" />

          <div className="comment-foot">
            <Comments.Likes className="comment-likes" />
            <Comments.ReplyLink className="comment-reply">Reply</Comments.ReplyLink>
          </div>

          {/* Recurses the same <Comments.Item> template for nested replies. */}
          <Comments.Replies className="comment-replies" />
        </Comments.Item>
      </Comments.List>
    </Comments.Root>
  );
}
```

`<Comments.Item>` is a *template*: `<Comments.List>` stamps it once per top-level comment, and `<Comments.Replies>` stamps the same subtree recursively for each nested reply. You write the row once.

## Styling

Nothing ships styled. Parts render a sensible default element (a `<div>`, `<span>`, `<time>`, `<img>`, or `<a>`) carrying `data-*` attributes that reflect runtime state, so you can style every state in pure CSS — no JavaScript branching. Booleans follow the Base UI convention: the attribute is **present** when true (`[data-loading]`) and **absent** when false, so `[data-loading]` is a bare-attribute selector.

### State attribute reference

Every attribute a part emits, derived from the components:

| Part | Attribute | Meaning |
|------|-----------|---------|
| `Comments.Root` | `aria-busy` | `"true"` while the initial fetch is in flight (cleared once loaded) |
| | `data-status` | `idle` \| `loading` \| `success` \| `error` |
| | `data-loading` | present while fetching |
| | `data-error` | present when the fetch failed |
| | `data-empty` | present once loaded with zero visible comments |
| | `data-count` | number of top-level comments |
| `Comments.List` | `data-count` | number of top-level comments |
| | `data-empty` | present when there are none |
| `Comments.Item` | `data-depth` | nesting level (`0` for top-level, `+1` per reply level) |
| | `data-comment` | present when the node is a real comment |
| | `data-blocked` | present when the node is a blocked-reply stub |
| | `data-not-found` | present when the node is a deleted-reply stub |
| | `data-labeled` | present when the comment carries moderation labels |
| | `data-has-replies` | present when the comment has replies |
| `Comments.Replies` | `data-depth` | nesting level of this reply group |
| | `data-count` | number of replies |
| `Comments.Author` | `data-handle` | the author's handle |
| `Comments.Likes` | `data-count` | the comment's own like count |
| `Comments.Labels` | `data-count` | number of labels |
| | `data-values` | space-joined label values |
| `Comments.Fallback` | `data-kind` | `blocked` \| `notFound` |
| `Comments.Stats` | `data-like-count` | root-post like count |
| | `data-reply-count` | root-post reply count |
| | `data-repost-count` | root-post repost count |
| | `data-quote-count` | root-post quote count |
| `Comments.ReplyLink` | `data-root` | present when the link targets the root post rather than a comment |
| `Comments.Loading` | `data-loading` | always present (renders only while loading) |
| `Comments.Error` | `data-error` | always present (renders only on error) |
| `Comments.Empty` | `data-empty` | always present (renders only when empty) |
| `Likes.Root` | `aria-busy` | `"true"` while fetching |
| | `data-status` | `idle` \| `loading` \| `success` \| `error` |
| | `data-loading` / `data-error` / `data-empty` | as on `Comments.Root` |
| | `data-total` | number of likes collected |
| `Likes.Count` | `data-total` | number of likes collected |
| `Likes.Avatars` | `data-count` | number of avatars rendered |
| | `data-total` | number of likes collected |
| `Likes.Avatar` | `data-handle` | the liker's handle |

`Comments.Avatar`, `Comments.Content`, and `Comments.Timestamp` emit no `data-*` of their own — `Content` renders the body text, `Avatar` an `<img>` (with `alt` and `loading="lazy"`), and `Timestamp` a `<time>` with a machine-readable `dateTime`.

### Styling states with CSS

```css
/* Dim the thread while it refetches. */
.comments[data-loading] { opacity: 0.6; }

/* Deleted / blocked placeholders read differently from real comments. */
.comment-fallback { font-style: italic; color: #888; }
.comment[data-blocked] .comment-head,
.comment[data-not-found] .comment-head { display: none; }

/* Indent nested replies — data-depth lets you cap or restyle depth with no JS. */
.comment-replies {
  margin-left: 0.75rem;
  padding-left: 1rem;
  border-left: 2px solid #e5e5e5;
}

/* Badge comments that carry moderation labels (surfaced, not hidden). */
.comment-labels {
  font-size: 0.7rem;
  text-transform: uppercase;
  border: 1px solid #ddd;
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
}
```

## Parts reference

Every part accepts the shared headless props — `className` (string or `(state) => string`), `style` (object or `(state) => CSSProperties`), and `render` (an element to clone or a `(props, state) => element` factory) — plus the intrinsic attributes of its default element. The **State** column is what those function-form props receive.

### `Comments.*`

| Part | Default element | State | Notes |
|------|-----------------|-------|-------|
| `Comments.Root` | `div` | `{ status, isEmpty, count }` | Provider + container. Runs the fetch/state machine; every other part reads its context. Takes all `useComments` options as props (`post`, `sort`, `maxDepth`, `filter`, `initialData`, `appView`, `fetchImpl`, `cacheTtlMs`). |
| `Comments.List` | `div` (`role="list"`) | `{ count, isEmpty }` | Renders top-level comments. Its single child is the item template. |
| `Comments.Item` | `div` (`role="listitem"`) | `{ node, depth, index, kind, isComment, isStub, hasReplies, labels }` | One comment row, and the template `List`/`Replies` repeat. |
| `Comments.Replies` | `div` (`role="list"`) | `{ count, depth }` | Recursively renders the current comment's replies with the same item template. Renders nothing for stubs or childless comments. |
| `Comments.Author` | `span` | `{ author, node }` | Defaults to `displayName`, falling back to `handle`. Renders nothing on a stub. |
| `Comments.Avatar` | `img` | `{ author, node }` | The author's avatar, `alt`-labelled and lazy-loaded. Renders nothing when there's no avatar. |
| `Comments.Content` | `div` | `{ text, node }` | The comment body text. |
| `Comments.Timestamp` | `time` | `{ date, node }` | `<time>` with a machine-readable `dateTime`; label defaults to a locale date string. Extra prop: `format?: (date: Date) => string`. |
| `Comments.Likes` | `span` | `{ count, node }` | The comment's *own* like count (not the `Likes.*` namespace). |
| `Comments.Labels` | `span` | `{ labels }` | Moderation labels on the comment (post + author, merged). Surfacing only — never a filter. Renders nothing when there are none. |
| `Comments.Fallback` | `div` | `{ kind, node }` | Placeholder for a deleted (`notFound`) or `blocked` reply. Renders only for stubs. |
| `Comments.Stats` | `div` | `{ likeCount, repostCount, replyCount, quoteCount, postUrl }` | Root-post engagement counts. Renders whatever children you give it. |
| `Comments.ReplyLink` | `a` | `{ href, node, isRoot }` | "Reply on Bluesky" link. Inside an `Item` it targets that comment; otherwise the root post. Opens in a new tab. Renders nothing until a URL is available. |
| `Comments.Loading` | `div` | `{}` | Renders only while the initial fetch is in flight. |
| `Comments.Error` | `div` (`role="alert"`) | `{ error }` | Renders only when the fetch failed. |
| `Comments.Empty` | `div` | `{}` | Renders only once loaded with zero visible comments. |

### `Likes.*`

| Part | Default element | State | Notes |
|------|-----------------|-------|-------|
| `Likes.Root` | `div` | `{ status, total, isEmpty }` | Provider + container for a post's likes. Takes all `useLikes` options as props (`post`, `pageSize`, `maxPages`, `initialData`, `appView`, `fetchImpl`, `cacheTtlMs`). |
| `Likes.Count` | `span` | `{ total }` | The collected like total. See the note below on totals. |
| `Likes.Avatars` | `div` | `{ count, total }` | One entry per liker. With a child template it repeats it; with no children it renders a default `<img>` stack. Extra prop: `max?: number` to cap how many render. |
| `Likes.Avatar` | `img` | `{ like, actor }` | A single liker's avatar, `alt`-labelled and lazy-loaded. Renders nothing when they have no avatar. |
| `Likes.Loading` | `div` | `{}` | Renders only while fetching. |
| `Likes.Empty` | `div` | `{}` | Renders only once loaded with zero likes. |
| `Likes.Error` | `div` (`role="alert"`) | `{ error }` | Renders only on failure. |

> **Totals caveat.** `getLikes` returns pages of actors, not a grand total, so `Likes.Count` reports the number actually *fetched* (capped by `pageSize × maxPages`), which can be fewer than the post's real like count. For the true like number, read `stats.likeCount` from `Comments.Stats` / `useComments` — the demo does exactly this (avatars from `Likes`, the count from the thread's stats).

## Hooks

The components are a thin shell over two hooks. Use them directly when you want your own markup entirely.

```ts
function useComments(options: UseCommentsOptions): UseCommentsReturn;

interface UseCommentsOptions {
  post: string;                          // at:// URI or bsky.app URL
  sort?: "newest" | "oldest" | "most-liked";  // initial order (uncontrolled)
  maxDepth?: number;                     // reply depth to fetch + keep (default 10)
  filter?: (node: CommentNode) => boolean;     // keep-when-true, applied tree-wide
  initialData?: ThreadResult;            // SSR seed; suppresses the mount fetch
  appView?: string;                      // override the AppView base URL
  fetchImpl?: typeof fetch;              // injectable fetch
  cacheTtlMs?: number;                   // handle→DID cache TTL
}

interface UseCommentsReturn {
  status: "idle" | "loading" | "success" | "error";
  data: ThreadResult | undefined;
  error: unknown;
  root: CommentNode | undefined;         // the root post node (may be a stub)
  stats: PostStats | undefined;          // root-post engagement counts
  postUrl: string | undefined;           // "reply on Bluesky" target
  comments: CommentNode[];               // top-level comments, sorted + filtered
  sort: SortOrder;
  setSort: (sort: SortOrder) => void;    // re-sorts client-side, no refetch
  refetch: () => void;
  isIdle: boolean; isLoading: boolean; isSuccess: boolean; isError: boolean;
  isEmpty: boolean;                      // loaded with zero visible comments
}
```

```ts
function useLikes(options: UseLikesOptions): UseLikesReturn;

interface UseLikesOptions {
  post: string;
  pageSize?: number;                     // actors per page (getLikes max 100)
  maxPages?: number;                     // page cap
  initialData?: LikesResult;             // SSR seed
  appView?: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
}

interface UseLikesReturn {
  status: "idle" | "loading" | "success" | "error";
  data: LikesResult | undefined;
  error: unknown;
  likes: Like[];                         // actors who liked (capped)
  total: number;                         // number collected
  cursor: string | undefined;            // set when likes remain uncollected
  refetch: () => void;
  isIdle: boolean; isLoading: boolean; isSuccess: boolean; isError: boolean;
  isEmpty: boolean;
}
```

Both fetch in an effect (never during render), so they're SSR-safe, and both guard latest-wins so a slow response can't clobber a newer one.

There's also `useCommentNode()` — the current `CommentNode` inside a `<Comments.Item>`, the escape hatch for building your own parts — and the context hooks `useCommentsContext()` / `useLikesContext()` (throw if used outside their `Root`).

### Hooks-only example

```tsx
import { useComments } from "@hedgerow/react";

function Thread({ post }: { post: string }) {
  const { comments, isLoading, isError, setSort } = useComments({ post });

  if (isLoading) return <p>Loading…</p>;
  if (isError) return <p>Couldn’t load comments.</p>;

  return (
    <>
      <select onChange={(e) => setSort(e.target.value as any)}>
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="most-liked">Most liked</option>
      </select>
      <ul>
        {comments.map((c) =>
          c.type === "comment" ? <li key={c.uri}>{c.text}</li> : null,
        )}
      </ul>
    </>
  );
}
```

## Recipes

### A custom sort control

`useComments` seeds sort from the `sort` prop (uncontrolled) and hands back `setSort` to change it — re-sorting happens client-side, with no refetch. Drop a control anywhere inside `Comments.Root` and read the context:

```tsx
import { Comments, useCommentsContext } from "@hedgerow/react";

function SortControl() {
  const { sort, setSort } = useCommentsContext();
  return (
    <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="most-liked">Most liked</option>
    </select>
  );
}

<Comments.Root post={post} sort="newest">
  <SortControl />
  <Comments.List>{/* … */}</Comments.List>
</Comments.Root>;
```

### Filtering by moderation labels

Labels are always **surfaced and never auto-hidden** — hiding labelled content is your policy call, made through the `filter` prop. `filter` runs over the whole tree (nested replies included); keep a node when it returns `true`:

```tsx
import type { CommentNode } from "@hedgerow/react";

// Hide any comment carrying a moderation label.
const hideLabelled = (node: CommentNode) =>
  node.type !== "comment" || node.labels.length === 0;

<Comments.Root post={post} filter={hideLabelled}>
  {/* … */}
</Comments.Root>;
```

Filter on whatever you like — a specific label value, an author DID, minimum likes. The core does none of this for you; it's entirely the consumer's choice.

### SSR / build-time seeding

For a busy page, fetch the thread on your server or at build time and pass it as `initialData`. `Comments.Root` then starts in `success` with your data and **skips the mount fetch** (it still refetches on a `post`/`maxDepth` change or an explicit `refetch()`). This avoids a client round-trip and a loading flash, and is the courteous thing to do to the public AppView.

```tsx
// Server component / getStaticProps / Astro frontmatter, etc.
import { fetchThread } from "@hedgerow/comments";

const initialData = await fetchThread(post);
```

```tsx
// Client
<Comments.Root post={post} initialData={initialData}>
  {/* … */}
</Comments.Root>
```

`useLikes` / `Likes.Root` take the same treatment via `fetchLikes` and their own `initialData`.

### Custom render via render props

Two forms, both Base-UI-style. Pass an **element** to swap the tag (our computed props — `className`, `style`, `data-*`, `ref`, event handlers — are merged into it):

```tsx
<Comments.Author render={<a href="/profile" />} />
```

Or a **function** to take full control and spread our props onto whatever you return:

```tsx
<Comments.Timestamp
  render={(props, state) => <time {...props}>{relativeTime(state.date)}</time>}
/>

<Comments.Likes
  render={(props, state) => <span {...props}>♥ {state.count}</span>}
/>
```

Function form gives you the part's `state` as the second argument; both forms chain your event handlers and compose your `ref` with ours rather than dropping either.

### Custom empty state

`Comments.Empty` renders only once loaded with zero comments. Fill it with whatever you want — a nudge plus the reply affordance reads well:

```tsx
<Comments.Empty className="empty">
  <p>No replies yet.</p>
  <Comments.ReplyLink>Be the first to reply on Bluesky →</Comments.ReplyLink>
</Comments.Empty>
```

## Accessibility

The parts set conservative defaults you can override: `Comments.Root` / `Likes.Root` carry `aria-busy` while fetching; `Comments.Error` / `Likes.Error` render with `role="alert"`; `Comments.List` and `Comments.Replies` are `role="list"` with each `Comments.Item` a `role="listitem"`; `Comments.Timestamp` is a `<time dateTime>`; avatars are `alt`-labelled and `loading="lazy"`; and `Comments.ReplyLink` opens in a new tab with `rel="noopener noreferrer"`. Any of these can be replaced by passing your own attribute (e.g. `role`, `target`) — your prop wins.

## License

[MIT](../../LICENSE)
