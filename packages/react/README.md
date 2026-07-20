# @hedgerow/react

Headless React components for showing live Bluesky comments and likes on your own site. Point a `<Comments.Root>` at one of your posts and its replies render on your page, reading straight from the public Bluesky AppView — no auth, no API key, no styles. Every part renders a plain default element and exposes its state through `className`/`style`/`render` functions and `data-*` attributes, so the markup and the look are entirely yours.

A third namespace, `Reply.*`, gives you a headless reply composer — but this package stays read-only and dependency-thin itself: `Reply.Root` takes `session`/`onSubmit` as plain props, so wiring up a real reader identity (e.g. [`@hedgerow/reader`](../reader)'s browser OAuth client) is entirely up to the consumer. See [Reply composer](#reply) below.

A fourth namespace, `Editor.*`, gives you a headless document editor — `document`/`onSave` are plain props too, and `Editor.Body` doesn't ship a rich-text editor of its own (it defaults to a plain `<textarea>`); mount whatever editor you like into its slot. See [Editor](#editor) below.

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
            <Comments.LikeCount className="comment-likes" />
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
| | `data-loading` | present ONLY during the initial fetch (never during a background refetch — see `data-revalidating`) |
| | `data-revalidating` | present while a refetch is in flight WITH previous data still showing (the optimistic confirm sweep, `revalidateOnMount`, an explicit `refetch()`) |
| | `data-error` | present when the fetch failed (can coexist with existing data — see [stale-while-error](#hooks)) |
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
| | `data-delivery` | `pending` \| `confirmed` \| `unconfirmed` for an optimistically-inserted reply (see [Optimistic replies](#optimistic-replies)); **absent** for an ordinarily-fetched node |
| | `data-entering` | present for one frame after a row mounts, EXCEPT the tree's very first population (seeded or freshly fetched) — that initial batch never gets it, so SSR output never carries it either. Only a node appearing AFTER the tree has already shown data once (a fresh optimistic insert, a node appearing for the first time on revalidate) gets it — a plain-CSS entry-transition hook, see below |
| `Comments.Replies` | `data-depth` | nesting level of this reply group |
| | `data-count` | number of replies |
| `Comments.Author` | `data-handle` | the author's handle |
| `Comments.LikeCount` | `data-count` | the comment's own like count |
| `Comments.LikeButton` | `data-liked` | present when the reader has liked this comment |
| | `data-busy` | present while the like/unlike write is in flight |
| | `data-disabled` | present when disabled (`Comments.Root`'s `onLikeComment`/`onUnlikeComment` aren't BOTH set, or `isCommentLiked` hasn't resolved yet) |
| `Comments.ReplyButton` | *(none — renders nothing when `Comments.Root`'s `onReplyToComment` is unset)* | |
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
| | `data-loading` / `data-revalidating` / `data-error` / `data-empty` | as on `Comments.Root` |
| | `data-total` | number of likes collected |
| `Likes.Count` | `data-total` | number of likes collected |
| `Likes.Button` | `data-liked` | present when `liked` is true |
| | `data-busy` | present while the toggle is in flight |
| | `data-disabled` | present when disabled (`liked` is still `undefined`, or `disabled` is set) |
| `Likes.Avatars` | `data-count` | number of avatars rendered |
| | `data-total` | number of likes collected |
| `Likes.Avatar` | `data-handle` | the liker's handle |
| `Reply.Root` | `data-status` | `idle` \| `submitting` \| `error` |
| | `data-signed-in` | present when `session` is non-null |
| | `data-submitting` | present while the reply is being written |
| | `data-error` | present when the last submit failed |
| `Reply.Field` | `data-submitting` | present while submitting |
| | `data-signed-in` | present when `session` is non-null |
| `Reply.Submit` | `data-submitting` | present while submitting |
| | `data-disabled` | present while submitting or the field is empty |
| `Reply.SignedIn` | `data-signed-in` | always present (renders only when `session` is non-null) |
| `Reply.SignedOut` | `data-signed-out` | always present (renders only when `session` is null) |
| `Reply.Error` | `data-error` | always present (renders only after a failed submit) |
| `Editor.Root` | `data-status` | `loading` \| `idle` \| `dirty` \| `saving` \| `saved` \| `error` |
| | `data-loading` / `data-dirty` / `data-saving` / `data-saved` / `data-error` | present per the matching status (no attribute for plain `idle`) |
| `Editor.Title` | `data-loading` / `data-saving` | present per state |
| `Editor.Body` (default `<textarea>`) | `data-loading` / `data-saving` | present per state |
| `Editor.Save` | `data-dirty` / `data-saving` | present per state |
| | `data-disabled` | present unless dirty (or while saving) |
| `Editor.Status` | `data-status` | same six values as `Editor.Root` |
| | `data-error` | present when the last save failed |

`Comments.Avatar`, `Comments.Content`, and `Comments.Timestamp` emit no `data-*` of their own — `Content` renders the body text, `Avatar` an `<img>` (with `alt` and `loading="lazy"`), and `Timestamp` a `<time>` with a machine-readable `dateTime`.

### `data-*` is a stable styling contract

Every `data-*` attribute above — its name and, where relevant, its precedence against your own props — is part of this package's public API, not an implementation detail. The one precedence rule every part follows uniformly: **a part's own computed `data-*` attributes always win over whatever you pass in `rest`** (they're spread after your props, not before). Practically, this means you can freely pass `data-*` attributes of your own for anything this library doesn't compute (e.g. `data-testid`), but you can't use a same-named `data-*` prop to override a computed one (e.g. you can't fake `data-liked` on `Comments.LikeButton` — it's authoritative). Non-`data-*` props (event handlers, `disabled`, etc.) follow their own per-part contract instead — see [Custom render via render props](#custom-render-via-render-props) for how event handlers chain rather than clobber.

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
| `Comments.Root` | `div` | `{ status, isEmpty, count }` | Provider + container. Runs the fetch/state machine; every other part reads its context. Takes all `useComments` options as props (`post`, `sort`, `maxDepth`, `filter`, `initialData`, `data`, `onRefetch`, `appView`, `fetchImpl`, `cacheTtlMs`, `optimisticGiveUpAfter`, `revalidateOnMount`, `confirmRetryDelays` — see [Hooks](#hooks) and [Controlled data](#controlled-data)), plus three auth-free per-verb UI callbacks: `onLikeComment?(node)`, `onUnlikeComment?(node)`, `onReplyToComment?(node)` (drive `Comments.LikeButton`/`Comments.ReplyButton`, see below), and `isCommentLiked?(node)`. |
| `Comments.Provider` | *(none — context only)* | — | The context half of `Comments.Root`, without the fetch/render half — for mounting `Comments.*` leaf parts against a `useComments()` call you own yourself. Takes `value` (a `UseCommentsReturn`) plus the same `onLikeComment`/`onUnlikeComment`/`onReplyToComment`/`isCommentLiked` props. Pairs with `Comments.ItemScope`. See [Hooks-only / custom trees](#hooks). |
| `Comments.List` | `div` (`role="list"`) | `{ count, isEmpty }` | Renders top-level comments. Its single child is the item template. |
| `Comments.ItemScope` | *(none — context only)* | — | Mount a single node (`node`, `depth?`, `index?`) at an arbitrary point in your own markup — the per-node counterpart to `Comments.Provider`, for a fully custom tree outside `Comments.List`'s built-in recursion. `children` doubles as the template `Comments.Replies` repeats for that node's own replies, same as `Comments.Item`'s children. |
| `Comments.Item` | `div` (`role="listitem"`) | `{ node, depth, index, kind, isComment, isStub, hasReplies, labels, deliveryState, isEntering }` | One comment row, and the template `List`/`Replies` repeat. `deliveryState`/`isEntering` back `data-delivery`/`data-entering` — see [Optimistic replies](#optimistic-replies). |
| `Comments.Replies` | `div` (`role="list"`) | `{ count, depth }` | Recursively renders the current comment's replies with the same item template. Renders nothing for stubs or childless comments. Doesn't accept `children` — it always repeats the enclosing item's own template. |
| `Comments.Author` | `span` | `{ author, node }` | Defaults to `displayName`, falling back to `handle`. Renders nothing on a stub. |
| `Comments.Avatar` | `img` | `{ author, node }` | The author's avatar, `alt`-labelled and lazy-loaded. Renders nothing when there's no avatar. |
| `Comments.Content` | `div` | `{ text, node }` | The comment body text. |
| `Comments.Timestamp` | `time` | `{ date, node }` | `<time>` with a machine-readable `dateTime`; label defaults to a locale date string. Extra prop: `format?: (date: Date) => string`. The default label can differ between server and client render (see [Hydration-safe timestamps](#hydration-safe-timestamps)). |
| `Comments.LikeCount` | `span` | `{ count, node }` | The comment's *own* like count. |
| `Comments.LikeButton` | `button` | `{ node, liked, count, isBusy, isDisabled }` | Like/unlike toggle for this comment. Calls `Comments.Root`'s `onLikeComment(node)`/`onUnlikeComment(node)`; disabled unless BOTH are set. Doesn't accept `onClick`/`disabled` directly (both are computed) — use `render` to reach the underlying element; a consumer handler given there still chains with the computed one, never gets dropped. See [Per-comment interactions](#per-comment-interactions). |
| `Comments.ReplyButton` | `button` | `{ node }` | Calls `Comments.Root`'s `onReplyToComment(node)` — does not open a composer itself (see [Per-comment interactions](#per-comment-interactions)). Renders nothing when `onReplyToComment` is unset. Doesn't accept `onClick` directly, same as `LikeButton`. |
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
| `Likes.Root` | `div` | `{ status, total, isEmpty }` | Provider + container for a post's likes. Takes all `useLikes` options as props (`post`, `pageSize`, `maxPages`, `initialData`, `data`, `onRefetch`, `appView`, `fetchImpl`, `cacheTtlMs`, `revalidateOnMount`). |
| `Likes.Provider` | *(none — context only)* | — | The context half of `Likes.Root` — mount `Likes.*` leaf parts against a `useLikes()` call you own yourself. Takes `value` (a `UseLikesReturn`). |
| `Likes.Count` | `span` | `{ total }` | The collected like total. See the note below on totals. |
| `Likes.Button` | `button` | `{ liked, count, isBusy, isDisabled }` | Standalone like/unlike toggle for the post — no `Likes.Root` needed. Takes `liked`, `count`, `onLike`, `onUnlike`, `disabled?` as props (same "injected, not imported" contract as `Reply.Root`'s `session`/`onSubmit`); doesn't accept `onClick` directly (computed, chains with a `render`-supplied handler). See [Liking the post](#liking-the-post). |
| `Likes.Avatars` | `div` | `{ count, total }` | One entry per liker. With a child template it repeats it; with no children it renders a default `<img>` stack. Extra prop: `max?: number` to cap how many render. |
| `Likes.Avatar` | `img` | `{ like, actor }` | A single liker's avatar, `alt`-labelled and lazy-loaded. Renders nothing when they have no avatar. |
| `Likes.Loading` | `div` | `{}` | Renders only while fetching. |
| `Likes.Empty` | `div` | `{}` | Renders only once loaded with zero likes. |
| `Likes.Error` | `div` (`role="alert"`) | `{ error }` | Renders only on failure. |

> **Totals caveat.** `getLikes` returns pages of actors, not a grand total, so `Likes.Count` reports the number actually *fetched* (capped by `pageSize × maxPages`), which can be fewer than the post's real like count. For the true like number, read `stats.likeCount` from `Comments.Stats` / `useComments` — the demo does exactly this (avatars from `Likes`, the count from the thread's stats).

### `Reply.*`

| Part | Default element | State | Notes |
|------|-----------------|-------|-------|
| `Reply.Root` | `form` | `{ status, isSignedIn, isSubmitting, isError }` | Provider + container. Takes `session` (`{ did, handle, displayName? } \| null`) and `onSubmit(text) => Promise<void \| false>` as props, plus `onSubmitted?: () => void` and `defaultValue?: string`. Renders a `<form>` whose native submit is intercepted and routed to `onSubmit` — a `Reply.Submit` click, or a manual `form.requestSubmit()`, triggers it. **Not** pressing Enter in `Reply.Field`: it's a `<textarea>` by default, and textareas don't implicit-submit on Enter (Enter just inserts a newline) — only a single-line `<input>` does that. Resolving `onSubmit` to `false` means "intercepted, not posted" — see [Auth on demand](#auth-on-demand) below. |
| `Reply.Field` | `textarea` | `{ value, isSubmitting, isSignedIn }` | The reply text, bound to `Reply.Root`'s own state — `value`/`onChange` aren't exposed as props (see the escape hatch below). |
| `Reply.Submit` | `button` (`type="submit"`) | `{ isSubmitting, isDisabled, isSignedIn }` | Disabled while submitting or the field is empty/whitespace. Defaults to "Reply" / "Posting…" text. |
| `Reply.SignedIn` | `div` | `{}` | Renders only when `session` is non-null. |
| `Reply.SignedOut` | `div` | `{}` | Renders only when `session` is null. |
| `Reply.Error` | `div` (`role="alert"`) | `{ error }` | Renders only after a failed submit; the field's text is preserved so the reader can retry. |

`Reply.*` has **no dependency on any auth library** — `session`/`onSubmit` are plain props, so you wire up [`@hedgerow/reader`](../reader)'s `createReader()` (or anything else that can produce a `{ did, handle, displayName? }` and write a reply) yourself:

```tsx
import { Reply } from "@hedgerow/react";
import { createReader } from "@hedgerow/reader";
import { useEffect, useState } from "react";

const reader = createReader(); // loopback client id in dev; pass clientId for a real deployment

function ReplyBox({ root, parent }: { root: { uri: string; cid: string }; parent: { uri: string; cid: string } }) {
  const [session, setSession] = useState<{ did: string; handle: string } | null>(null);

  useEffect(() => {
    reader.restore().then(setSession);
  }, []);

  return (
    <Reply.Root
      className="reply-box"
      session={session}
      onSubmit={(text) => reader.createReply({ root, parent, text }).then(() => {})}
    >
      <Reply.SignedOut className="reply-signed-out">
        <button type="button" onClick={() => reader.signIn(prompt("Your handle?") ?? "")}>
          Log in with Bluesky
        </button>
      </Reply.SignedOut>
      <Reply.SignedIn className="reply-signed-in">
        <Reply.Field className="reply-field" placeholder="Write a reply…" />
        <Reply.Submit className="reply-submit" />
        <Reply.Error className="reply-error" />
      </Reply.SignedIn>
    </Reply.Root>
  );
}
```

For a fully custom field (not the built-in `Reply.Field`), read `value`/`setValue` directly off `useReplyContext()` — the same escape hatch the [custom sort control](#a-custom-sort-control) recipe uses for `Comments`:

```tsx
import { useReplyContext } from "@hedgerow/react";

function CustomField() {
  const { value, setValue } = useReplyContext();
  return <input value={value} onChange={(e) => setValue(e.target.value)} />;
}
```

### `Editor.*`

| Part | Default element | State | Notes |
|------|-----------------|-------|-------|
| `Editor.Root` | `form` | `{ status, isLoading, isDirty, isSaving, isSaved, isError }` | Provider + container. Takes `document` (`{ title, markdown } \| null` — `null` means still loading) and `onSave(fields) => Promise<void>` as props. A NEW `document` object resets the fields; re-rendering with the SAME reference never clobbers unsaved edits. Renders a `<form>` whose native submit is intercepted and routed to `save()` — an `Editor.Save` click, or a manual `form.requestSubmit()`, triggers it (same caveat as `Reply.Root`: the default `Editor.Body` is a `<textarea>`, so Enter alone never submits it). |
| `Editor.Title` | `input` | `{ value, isLoading, isSaving }` | The title, bound to `Editor.Root`'s state. Disabled while loading. |
| `Editor.Body` | `textarea` | `{ value, isLoading, isSaving }` | A headless SLOT, not an editor. By default a plain `<textarea>` bound to the markdown string. Its `slot` prop is DIFFERENT from every other part's `render`: `slot={(s) => ...}` where `s` is `{ value, onChange }` for the markdown string directly — not this library's usual `(props, state) => element` DOM-props contract — because a real rich-text editor component has nothing to do with spread DOM attributes. Named `slot` specifically so it's never confused with `render` (a part where `render` means something different from everywhere else would be the actual bug) — `Editor.Body` doesn't accept a `render` prop at all. This is the mount point for e.g. Tiptap; `@hedgerow/react` never ships an editor. |
| `Editor.Save` | `button` (`type="submit"`) | `{ isDirty, isSaving, isDisabled }` | Disabled unless the document is dirty (or while saving). Defaults to "Save" / "Saving…" text. |
| `Editor.Status` | `div` (`role="alert"` when errored) | `{ status, error }` | Always rendered; defaults to a status label ("Unsaved changes", "Saving…", "Saved", "Couldn't save"). Exposes the save error via `state.error`. |

`Editor.*` has **no dependency on `@hedgerow/publish`, `@hedgerow/reader`, or any editor library** — `document`/`onSave` are plain props, so you decide how to load a record and how to persist it. The demo (`apps/demo/src/components/EditorIsland.tsx`) is the reference: it reads via `@hedgerow/publish`'s browser-safe core and saves via `@hedgerow/reader`'s `asPublisher()`, with Tiptap (`@tiptap/react` + `@tiptap/starter-kit` + `tiptap-markdown`, app-land dependencies only) mounted into `Editor.Body`:

```tsx
import { Editor } from "@hedgerow/react";
import TiptapMarkdownEditor from "./TiptapMarkdownEditor"; // wraps @tiptap/react

function PostEditor({ document, onSave }: { document: { title: string; markdown: string } | null; onSave: (fields: { title: string; markdown: string }) => Promise<void> }) {
  return (
    <Editor.Root document={document} onSave={onSave}>
      <Editor.Title />
      <Editor.Body slot={(slot) => <TiptapMarkdownEditor value={slot.value} onChange={slot.onChange} />} />
      <Editor.Save />
      <Editor.Status />
    </Editor.Root>
  );
}
```

### Liking the post

`Likes.Button` follows the exact same "state and the write are both injected" idiom as `Reply.Root`: it never imports `@hedgerow/reader` or any auth library, so it's just as usable with a server-backed auth of your own. Wire it to [`@hedgerow/reader`](../reader)'s `like`/`unlike`/`findLike`:

```tsx
import { Comments, Likes, useCommentsContext } from "@hedgerow/react";
import { createReader } from "@hedgerow/reader";
import { useEffect, useState } from "react";

const reader = createReader();

function PostLikeButton() {
  const { data, root, stats } = useCommentsContext(); // must render inside <Comments.Root>
  const [likeUri, setLikeUri] = useState<string | null | undefined>(undefined); // undefined = unknown yet

  useEffect(() => {
    if (!data) return;
    reader.findLike(data.uri).then(setLikeUri);
  }, [data?.uri]);

  if (!data || !root || root.type !== "comment") return null;
  const subject = { uri: data.uri, cid: root.cid };

  return (
    <Likes.Button
      liked={likeUri != null}
      count={stats?.likeCount ?? 0}
      onLike={() => reader.like(subject).then((ref) => setLikeUri(ref.uri))}
      onUnlike={() => likeUri && reader.unlike(likeUri).then(() => setLikeUri(null))}
    />
  );
}
```

`count` is whatever authoritative number you pass in — `Likes.Button` only *adjusts* it by ±1 around your in-flight toggle, then defers back to your prop once it catches up. For "did I like this", there's no authenticated AppView to ask directly, so `@hedgerow/reader`'s `findLike` pages the reader's own repo instead — see its README for the honest bound on that (a very old like, under a very deep like history, may not be found) and how `like()` mitigates the resulting duplicate-record risk.

### Per-comment interactions

`Comments.LikeButton` and `Comments.ReplyButton` are the per-comment counterparts, driven by three props on `Comments.Root`:

```tsx
<Comments.Root
  post={post}
  onLikeComment={(node) => reader.like({ uri: node.uri, cid: node.cid }).then(() => {})}
  onUnlikeComment={(node) => likedUris.get(node.uri)?.then((uri) => uri && reader.unlike(uri))}
  onReplyToComment={(node) => setReplyTarget({ uri: node.uri, cid: node.cid, handle: node.author.handle })}
  isCommentLiked={(node) => likedByUri[node.uri]} // your own cache of findLike() results, keyed by uri
>
  <Comments.List>
    <Comments.Item>
      <Comments.LikeButton />
      <Comments.ReplyButton>Reply</Comments.ReplyButton>
      <Comments.Replies />
    </Comments.Item>
  </Comments.List>
</Comments.Root>
```

`Comments.ReplyButton` does **not** open its own composer — it just calls `onReplyToComment(node)` so you can retarget your existing `Reply.*` composer's `parent` at `{ uri: node.uri, cid: node.cid }` (keeping `root` as the thread root). One composer instance, retargeted, not one mounted per comment — see the demo's `CommentThread.tsx` for the full "Replying to @handle · Cancel" pattern. `Comments.ReplyButton` is unrendered whenever `onReplyToComment` is omitted; `Comments.LikeButton` is disabled unless BOTH `onLikeComment` and `onUnlikeComment` are set — so this whole surface stays inert (and `@hedgerow/react` stays auth-free) until you wire it up. The three props are independent: pass only the ones you need (e.g. a read-only embed with likes but no reply UI).

### Optimistic replies

`@hedgerow/reader`'s `createReply()` (or your own write) already returns the new reply's real `{ uri, cid }` once the write succeeds — well before any AppView has indexed it. `useComments()`'s `addOptimisticReply({ ref, parentUri, text, author })` inserts that reply into the tree **immediately**, keyed by its own real uri (no temp-id reconciliation), nested under `parentUri` (the root post's uri for a top-level reply, or an existing comment's uri for a nested one) — and arms a confirm-retry schedule (`confirmRetryDelays`, default `[2000, 4000, 6000]` ms) that refetches at each delay, but only while this specific reply is still pending:

```tsx
const { addOptimisticReply } = useCommentsContext();

async function handleSubmit(text: string) {
  const ref = await reader.createReply({ root, parent, text });
  addOptimisticReply({ ref, parentUri: parent.uri, text, author: session });
  // That's it — the confirm-retry schedule (refetching a few seconds out,
  // only if this reply is still pending by then) is built into the hook.
  // Not awaited: the reply is already visible via the optimistic insert
  // above, so there's no reason to keep the composer in a submitting state.
}
```

Tune or disable the schedule via `useComments`'s/`Comments.Root`'s `confirmRetryDelays` prop (e.g. `confirmRetryDelays={[1000, 3000]}`, or `[]` to rely entirely on your own `refetch()` calls).

The node then moves through `Comments.Item`'s `data-delivery`, exposed as `state.deliveryState` too:

- **`pending`** — the write succeeded; no `refetch()` has found it in the real tree yet.
- **`confirmed`** — a `refetch()` just found it (briefly, ~1.2s, as a hand-off signal before the attribute disappears — it's now just an ordinary node).
- **`unconfirmed`** — `optimisticGiveUpAfter` (default 3) refetches passed without the AppView indexing it. **The node keeps showing regardless** — this state exists specifically so a reply the write actually succeeded for never just vanishes.

`Comments.Item` also carries `data-entering` for exactly one frame after a row mounts — but NOT for the tree's very first population (seeded via `initialData`/`data`, or the first successful fetch): that initial batch never animates, and SSR output never carries `data-entering` at all. Only a node appearing after the tree has already shown data once — a brand new optimistic insert, or a node showing up for the first time on a revalidate — gets it (existing rows don't re-trigger it, since React keys each item by uri and only a genuinely new one gets a fresh mount). Style the "before" look on `[data-entering]` and let a `transition` animate to the resting style once it's removed:

```css
.comment {
  opacity: 1;
  transition: opacity 0.3s ease;
}
.comment[data-entering] { opacity: 0; }
.comment[data-delivery="pending"],
.comment[data-delivery="unconfirmed"] { opacity: 0.6; }
.comment[data-delivery="pending"]::after { content: "Sending…"; }
.comment[data-delivery="unconfirmed"]::after { content: "Not visible to others yet"; }
```

v1 ships entering-only transitions out of the box — but that's a narrower gap than it sounds, since a node is essentially never *removed* from the tree in this data model (an unconfirmed optimistic reply just keeps showing, per above). The one case where React genuinely unmounts rows is your own `filter`/`sort` reshaping what's visible; reach for [Framer Motion's `AnimatePresence`](https://motion.dev/docs/react-animate-presence) if you want that animated — see the [exit-animation recipe](#animated-entryexit-with-framer-motion) below.

### Auth on demand

Every part in this library is happy to render fully **enabled** for a signed-out reader — nothing here gates on a session by hiding UI. That's deliberate: "interaction-first, auth-on-demand" (compose a reply, tap Like, decide auth is worth it only once you've committed to the action) is a first-class pattern, not a workaround. Four seams make it possible:

1. **Pass the write handlers unconditionally.** Don't do `onLikeComment={session ? handleLike : undefined}` — that's what makes `Comments.ReplyButton` render nothing and `Comments.LikeButton` hard-disable (see the state table above: both key off whether the prop is *set*, not whether a session exists). Pass `onLikeComment`/`onUnlikeComment`/`onReplyToComment`/`isCommentLiked` (and `Reply.Root`'s `session`/`onSubmit`, `Likes.Button`'s `onLike`/`onUnlike`) every time; check `session` **inside** the handler instead.
2. **`isCommentLiked` must return `false`, not `undefined`, for "signed out."** `undefined` means "unknown — resolving," which `Comments.LikeButton`/`Likes.Button` correctly treat as not-yet-safe-to-toggle (`isDisabled` when `liked === undefined`, per `useLikeButton`). A signed-out reader isn't in an unresolved state, though — they're definitely not shown as having liked anything — so report `false`. That keeps the toggle live: a click still fires `onLikeComment`, which is exactly where you open your auth gate. The same applies to `Likes.Button`'s own `liked` prop for the root post.
3. **Gate a like from inside `onLikeComment`/`onUnlikeComment` (or `Likes.Button`'s `onLike`/`onUnlike`) by rejecting.** `useLikeButton`'s optimistic overlay only rolls back on a rejection (see its own doc comment — "Not rethrown," by design, since it's the consumer's own callback that failed, not the button). So: open your auth modal (stash whatever context you need), then `throw`/reject. The optimistic flip-and-roll-back is a single React-batched update, so nothing visibly flashes "liked" before it reverts.
4. **Gate a reply submit by resolving `onSubmit` to `false`.** This is what `false` (over throwing, which flips `status` to `"error"` and shows `Reply.Error`) is *for*: "intercepted, not posted" isn't a failure. The field's text survives either way — write your own intent-stash (session, sessionStorage, wherever) inside `onSubmit`, return `false`, and the composer just sits there with the draft intact until the reader actually has a session, at which point a real `onSubmit` call posts it.

```tsx
<Comments.Root
  post={post}
  onReplyToComment={(node) => setReplyTarget(node)} // free — no session needed to aim the composer
  onLikeComment={(node) => {
    if (!session) return openAuthGate({ action: "like", node }).then(() => { throw new Error("gated"); });
    return reader.like(node).then(() => {});
  }}
  onUnlikeComment={(node) => {
    if (!session) return openAuthGate({ action: "unlike", node }).then(() => { throw new Error("gated"); });
    return reader.unlike(likedByUri[node.uri]!);
  }}
  isCommentLiked={(node) => (session ? likedByUri[node.uri] != null : false)}
>
  {/* … */}
</Comments.Root>

<Reply.Root
  session={session}
  onSubmit={(text) => {
    if (!session) return openAuthGate({ text }).then(() => false as const);
    return reader.createReply({ root, parent, text }).then(() => {});
  }}
>
  {/* Field/Submit render unconditionally — no Reply.SignedOut wrapper */}
  <Reply.Field />
  <Reply.Submit />
  <Reply.Error />
</Reply.Root>
```

Surviving an OAuth **redirect** (the reader leaves the page entirely to authorize, then comes back) is one layer up from any of this — it's `sessionStorage` plus whatever your auth provider's session-restore call does on return, both consumer-side, no library involvement. See the demo's `CommentThread.tsx` for the full reference: it stashes `{ draft, replyTarget, pendingAction }` keyed by post right before redirecting, and rehydrates (restoring the draft/target, auto-performing a pending like, focusing the field for a pending reply without auto-posting it) once `reader.restore()` resolves after the redirect back.

## Hooks

The components are a thin shell over five hooks. Use them directly when you want your own markup entirely.

```ts
function useComments(options: UseCommentsOptions): UseCommentsReturn;

interface UseCommentsOptions {
  post: string;                          // at:// URI or bsky.app URL
  sort?: "newest" | "oldest" | "most-liked";  // initial order (uncontrolled)
  maxDepth?: number;                     // reply depth to fetch + keep (default 10)
  filter?: (node: CommentNode) => boolean;     // keep-when-true, applied tree-wide
  initialData?: ThreadResult;            // SSR seed; suppresses the mount fetch
  data?: ThreadResult;                   // controlled mode — see "Controlled data" below; when this key is present, the hook never fetches on its own
  onRefetch?: () => void;                // what refetch() calls in controlled mode, instead of fetching
  appView?: string;                      // override the AppView base URL
  fetchImpl?: typeof fetch;              // injectable fetch
  cacheTtlMs?: number;                   // handle→DID cache TTL
  optimisticGiveUpAfter?: number;        // refetches before a pending optimistic reply flips to "unconfirmed" (default 3)
  revalidateOnMount?: boolean;           // with initialData seeded, fire one extra refetch right after mount (default false)
  confirmRetryDelays?: number[];         // addOptimisticReply's confirm-retry schedule, ms (default [2000, 4000, 6000])
}

interface UseCommentsReturn {
  status: "idle" | "loading" | "success" | "error";
  data: ThreadResult | undefined;
  error: unknown;                        // always undefined in controlled mode — you own your own query's error state
  root: CommentNode | undefined;         // the root post node (may be a stub)
  stats: PostStats | undefined;          // root-post engagement counts
  postUrl: string | undefined;           // "reply on Bluesky" target
  comments: CommentNode[];               // top-level comments, sorted + filtered + optimistic replies merged in
  sort: SortOrder;
  setSort: (sort: SortOrder) => void;    // re-sorts client-side, no refetch
  refetch: () => void;                   // also drives the optimistic confirm/unconfirm sweep — see Optimistic replies
  isIdle: boolean; isLoading: boolean; isRevalidating: boolean; isSuccess: boolean; isError: boolean;
  isEmpty: boolean;                      // loaded with zero visible comments
  addOptimisticReply: (input: OptimisticReplyInput) => void; // see Optimistic replies
  deliveryStateOf: (uri: string) => "pending" | "confirmed" | "unconfirmed" | undefined; // Comments.Item's data-delivery source
}
```

```ts
function useLikes(options: UseLikesOptions): UseLikesReturn;

interface UseLikesOptions {
  post: string;
  pageSize?: number;                     // actors per page (getLikes max 100)
  maxPages?: number;                     // page cap
  initialData?: LikesResult;             // SSR seed
  data?: LikesResult;                    // controlled mode — same contract as useComments' `data`
  onRefetch?: () => void;
  appView?: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  revalidateOnMount?: boolean;
}

interface UseLikesReturn {
  status: "idle" | "loading" | "success" | "error";
  data: LikesResult | undefined;
  error: unknown;                        // always undefined in controlled mode
  likes: Like[];                         // actors who liked (capped)
  total: number;                         // number collected
  cursor: string | undefined;            // set when likes remain uncollected
  refetch: () => void;
  isIdle: boolean; isLoading: boolean; isRevalidating: boolean; isSuccess: boolean; isError: boolean;
  isEmpty: boolean;
}
```

Both fetch in an effect (never during render), so they're SSR-safe, and both guard latest-wins so a slow response can't clobber a newer one. Both are also **stale-while-error**: if a background `refetch()` fails, the previously-loaded data keeps showing (`isError` and existing data coexist) rather than getting nulled out — only a fetch that never had prior data ends up with `data: undefined` on failure.

### Controlled data

Both hooks (and `Comments.Root`/`Likes.Root`) accept a `data` prop for driving them from your OWN fetch layer — TanStack Query, SWR, a Redux/Zustand cache, whatever — instead of the built-in one. The moment the `data` key is present at all (even as `undefined`, while your own query is still pending — this is deliberately about *presence*, not the current value, so a still-loading TanStack Query doesn't get misread as "uncontrolled"), the hook's internal `fetchThread`/`fetchLikes` call is disabled entirely:

```tsx
function Thread({ post }: { post: string }) {
  const query = useQuery({ queryKey: ["thread", post], queryFn: () => fetchThread(post) });
  return (
    <Comments.Root post={post} data={query.data} onRefetch={query.refetch}>
      {/* status derives from `data` ("idle" while undefined, "success" once
          present) — drive your own loading UI off query.isLoading/isError
          rather than Comments.Loading/Comments.Error, which have nothing to
          say about a fetch this hook never made itself. */}
      <Comments.List>{/* … */}</Comments.List>
    </Comments.Root>
  );
}
```

`refetch()` (yours, or the one wired up by `Reply.*`/`addOptimisticReply`'s confirm-retry schedule) calls your `onRefetch` instead of fetching. The whole derive layer — sort, `filter`, the optimistic graft, and the confirm/unconfirm sweep — still runs, re-evaluated every time your `data` reference changes, so `addOptimisticReply` + a query refetch confirms exactly the same way it does in uncontrolled mode.

### Hooks-only / custom trees

`Comments.Provider` and `Comments.ItemScope` (and `Likes.Provider`) are the context-only halves of `Comments.Root`/`Comments.Item`/`Likes.Root` — for mounting leaf parts (`Comments.Author`, `Comments.Content`, …) against a `useComments()`/`useLikes()` call you already own, in a tree shape entirely your own (not `Comments.List`'s built-in top-level map + `Comments.Replies`' recursion):

```tsx
function CustomThread({ post }: { post: string }) {
  const thread = useComments({ post });
  if (!thread.isSuccess) return null;
  return (
    <Comments.Provider value={thread} onLikeComment={handleLike} onUnlikeComment={handleUnlike}>
      {thread.comments.map((node) => (
        <Comments.ItemScope key={node.uri} node={node}>
          <MyCustomRow>
            <Comments.Author />
            <Comments.Content />
            <Comments.Replies /> {/* recurses using this SAME template */}
          </MyCustomRow>
        </Comments.ItemScope>
      ))}
    </Comments.Provider>
  );
}
```

```ts
function useReply(options: UseReplyOptions): UseReplyReturn;

interface UseReplyOptions {
  session: { did: string; handle: string; displayName?: string } | null;
  onSubmit: (text: string) => Promise<void | false>; // resolve `false` to keep the draft without posting — see "Auth on demand"
  onSubmitted?: () => void;               // called once the field is cleared after a successful submit
  defaultValue?: string;                  // initial field text (uncontrolled)
}

interface UseReplyReturn {
  session: { did: string; handle: string; displayName?: string } | null;
  isSignedIn: boolean;
  status: "idle" | "submitting" | "error";
  isSubmitting: boolean; isError: boolean;
  error: unknown;
  value: string;
  setValue: (value: string) => void;
  submit: () => Promise<void>;            // no-ops while submitting or the value is empty
}
```

Unlike the other two, `useReply` fetches nothing — it's pure client-side composer state; `onSubmit` is where you plug in the actual write (e.g. [`@hedgerow/reader`](../reader)'s `createReply`).

```ts
function useEditor(options: UseEditorOptions): UseEditorReturn;

interface UseEditorOptions {
  document: { title: string; markdown: string } | null;  // null = still loading
  onSave: (fields: { title: string; markdown: string }) => Promise<void>;
}

interface UseEditorReturn {
  status: "loading" | "idle" | "dirty" | "saving" | "saved" | "error";
  isLoading: boolean; isDirty: boolean; isSaving: boolean; isSaved: boolean; isError: boolean;
  error: unknown;
  title: string; markdown: string;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  save: () => Promise<void>;             // no-ops unless status is "dirty"
}
```

Like `useReply`, `useEditor` fetches nothing — `document`/`onSave` are where you plug in the actual read/write (the demo uses `@hedgerow/publish`'s read core + `@hedgerow/reader`'s `asPublisher()`).

`useLikeButton(options)` is the engine behind `Likes.Button`/`Comments.LikeButton` — same shape as `useReply`: `{ liked, count, onLike, onUnlike, disabled? }` in, `{ liked, count, isBusy, isDisabled, toggle }` out, with the optimistic ±1 count adjustment and rollback-on-rejection built in. Use it directly for fully custom like UI.

There's also `useCommentNode()` — the current `CommentNode` inside a `<Comments.Item>` (or `Comments.ItemScope`), the escape hatch for building your own parts — and the context hooks `useCommentsContext()` / `useCommentItemContext()` / `useLikesContext()` / `useLikeItemContext()` / `useReplyContext()` / `useEditorContext()` (throw if used outside their respective `Root`/`Item`; `useOptionalCommentItem()` returns `null` instead of throwing, for parts usable in or out of an item, like `Comments.ReplyLink`).

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

If your `initialData` snapshot can go stale between when it was captured and when a given visitor loads the page (a statically-generated build, cached at the edge, etc.), add `revalidateOnMount` — it fires exactly one extra `refetch()` right after mount, on top of the seeded render (still no loading flash: the seed shows immediately, `data-revalidating` reflects the extra fetch instead of `data-loading`):

```tsx
<Comments.Root post={post} initialData={initialData} revalidateOnMount>
  {/* … */}
</Comments.Root>
```

#### Multiple threads on one page (an index/listing view)

The same seeding works for many `Comments.Root`s at once — e.g. a summary line ("12 replies") per post on a blog index. Fetch each thread server-side with a shallow `maxDepth` (you only need the reply count, not the nested tree) and seed each instance:

```tsx
// Server: one fetchThread per post, capped shallow — cheap even for a page of 20 posts.
const summaries = await Promise.all(
  posts.map((p) => fetchThread(p.bskyPostUri, { maxDepth: 1 })),
);
```

```tsx
// Client: one Comments.Root per post, each seeded with its own snapshot.
{posts.map((post, i) => (
  <Comments.Root key={post.slug} post={post.bskyPostUri} maxDepth={1} initialData={summaries[i]}>
    <Comments.Stats
      render={(props, state) => <p {...props}>{state.replyCount} replies</p>}
    />
  </Comments.Root>
))}
```

Each `Comments.Root` is independent — no shared state, no risk of one thread's optimistic update leaking into another's.

### Hydration-safe timestamps

`Comments.Timestamp`'s default label (`Intl.DateTimeFormat` with no explicit `timeZone`) renders in the *reader's* local timezone. When the server and the client disagree about that timezone — which is the common case for SSR/SSG, not an edge case — the server-rendered label and the client's first render can legitimately differ, and React will emit a hydration-mismatch warning for the text content. `dateTime` itself never mismatches (it's `node.createdAt`, a fixed ISO string); only the human-readable label can.

Two ways to avoid it entirely:

```tsx
// Option 1: a fixed, timezone-independent format (identical on server and client).
<Comments.Timestamp format={(date) => date.toISOString().slice(0, 10)} />

// Option 2: compute a relative/local label client-side only, after mount —
// render a stable placeholder for the very first (server-matching) render.
function ClientTimestamp() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Comments.Timestamp format={(date) => (mounted ? relativeTime(date) : date.toISOString())} />
  );
}
```

Or simply accept the one-time correction — React repairs mismatched text content on its own, and for a timestamp label it's rarely a visible problem in practice.

### Custom render via render props

Two forms, both Base-UI-style. Pass an **element** to swap the tag (our computed props — `className`, `style`, `data-*`, `ref`, event handlers — are merged into it, with matching event handlers CHAINED — ours first, then yours — rather than either one dropping the other):

```tsx
<Comments.Author render={<a href="/profile" />} />
```

Or a **function** to take full control and spread our props onto whatever you return:

```tsx
<Comments.Timestamp
  render={(props, state) => <time {...props}>{relativeTime(state.date)}</time>}
/>

<Comments.LikeCount
  render={(props, state) => <span {...props}>♥ {state.count}</span>}
/>
```

Function form gives you the part's `state` as the second argument; both forms chain your event handlers and compose your `ref` with ours rather than dropping either.

The element form's handler chaining is also what makes `render` compose cleanly with a Radix-style `asChild`-adjacent trigger component — one that already wires up its own `onClick` internally:

```tsx
import * as Dialog from "@radix-ui/react-dialog";

// Both fire: Radix's own click handling (opens the dialog) AND
// onReplyToComment (retargets your composer) — neither one clobbers the
// other, so you can point a dialog-based composer at the same trigger a
// plain in-page one would use.
<Comments.ReplyButton render={<Dialog.Trigger />}>Reply</Comments.ReplyButton>
```

### Animated entry/exit with Framer Motion

`Comments.List`'s `render` receives the already-built item list as `props.children`, so wrapping it in [`AnimatePresence`](https://motion.dev/docs/react-animate-presence) — and each `Comments.Item` in `motion.div` via `render`'s element-clone form — gets you real exit animations on top of the built-in entry ones (`data-entering`, see [Optimistic replies](#optimistic-replies)):

```tsx
import { AnimatePresence, motion } from "motion/react";

<Comments.List render={(props) => <AnimatePresence>{props.children}</AnimatePresence>}>
  <Comments.Item
    render={<motion.div layout exit={{ opacity: 0, height: 0 }} />}
  >
    {/* … */}
  </Comments.Item>
</Comments.List>
```

Removals are rare in this data model (an unconfirmed optimistic reply is never removed, only redecorated — see `data-delivery`), so most consumers won't need this; it matters when your own `filter`/`sort` genuinely drops rows a reader had already seen.

### i18n

Every default string this package renders (`"Reply"` / `"Posting…"` on `Reply.Submit`, `"Save"` / `"Saving…"` on `Editor.Save`, the `Editor.Status` labels, `Comments.Fallback`'s `"Blocked reply"` / `"This reply was deleted"`, `Comments.ReplyLink`'s `"Reply on Bluesky"`, …) is a `children` default (`children ?? "…"`), never hardcoded into markup you can't reach. Pass your own translated `children` — a static string or a function of `state` — to replace any of them:

```tsx
<Reply.Submit>{t("reply.submit")}</Reply.Submit>
<Comments.Fallback>{(state) => t(`fallback.${state.kind}`)}</Comments.Fallback>
```

There's no i18n framework baked in and none of these strings are extracted to a catalog for you — this is just the seam that makes plugging in whichever one you use (`react-intl`, `i18next`, a hand-rolled `t()`) straightforward.

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
