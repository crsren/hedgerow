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
| | `data-state` | `pending` \| `confirmed` \| `unconfirmed` for an optimistically-inserted reply (see [Optimistic replies](#optimistic-replies)); **absent** for an ordinarily-fetched node |
| | `data-entering` | present for one frame after this row first mounts (a fresh optimistic insert, or a node appearing for the first time on revalidate) — a plain-CSS entry-transition hook, see below |
| `Comments.Replies` | `data-depth` | nesting level of this reply group |
| | `data-count` | number of replies |
| `Comments.Author` | `data-handle` | the author's handle |
| `Comments.Likes` | `data-count` | the comment's own like count |
| `Comments.LikeButton` | `data-liked` | present when the reader has liked this comment |
| | `data-busy` | present while the like/unlike write is in flight |
| | `data-disabled` | present when disabled (`Comments.Root`'s `onCommentAction` is unset, or `isCommentLiked` hasn't resolved yet) |
| `Comments.ReplyButton` | *(none — renders nothing when `Comments.Root`'s `onCommentAction` is unset)* | |
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
| `Editor.Root` | `data-status` | `loading` \| `editing` \| `dirty` \| `saving` \| `saved` \| `error` |
| | `data-loading` / `data-dirty` / `data-saving` / `data-saved` / `data-error` | present per the matching status |
| `Editor.Title` | `data-loading` / `data-saving` | present per state |
| `Editor.Body` (default `<textarea>`) | `data-loading` / `data-saving` | present per state |
| `Editor.Save` | `data-dirty` / `data-saving` | present per state |
| | `data-disabled` | present unless dirty (or while saving) |
| `Editor.Status` | `data-status` | same six values as `Editor.Root` |
| | `data-error` | present when the last save failed |

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
| `Comments.Root` | `div` | `{ status, isEmpty, count }` | Provider + container. Runs the fetch/state machine; every other part reads its context. Takes all `useComments` options as props (`post`, `sort`, `maxDepth`, `filter`, `initialData`, `appView`, `fetchImpl`, `cacheTtlMs`, `optimisticGiveUpAfter`), plus two auth-free UI callbacks: `onCommentAction?(action, node)` (drives `Comments.LikeButton`/`Comments.ReplyButton`, see below) and `isCommentLiked?(node)`. |
| `Comments.List` | `div` (`role="list"`) | `{ count, isEmpty }` | Renders top-level comments. Its single child is the item template. |
| `Comments.Item` | `div` (`role="listitem"`) | `{ node, depth, index, kind, isComment, isStub, hasReplies, labels, deliveryState, isEntering }` | One comment row, and the template `List`/`Replies` repeat. `deliveryState`/`isEntering` back `data-state`/`data-entering` — see [Optimistic replies](#optimistic-replies). |
| `Comments.Replies` | `div` (`role="list"`) | `{ count, depth }` | Recursively renders the current comment's replies with the same item template. Renders nothing for stubs or childless comments. |
| `Comments.Author` | `span` | `{ author, node }` | Defaults to `displayName`, falling back to `handle`. Renders nothing on a stub. |
| `Comments.Avatar` | `img` | `{ author, node }` | The author's avatar, `alt`-labelled and lazy-loaded. Renders nothing when there's no avatar. |
| `Comments.Content` | `div` | `{ text, node }` | The comment body text. |
| `Comments.Timestamp` | `time` | `{ date, node }` | `<time>` with a machine-readable `dateTime`; label defaults to a locale date string. Extra prop: `format?: (date: Date) => string`. |
| `Comments.Likes` | `span` | `{ count, node }` | The comment's *own* like count (not the `Likes.*` namespace). |
| `Comments.LikeButton` | `button` | `{ node, liked, count, isBusy, isDisabled }` | Like/unlike toggle for this comment. Calls `Comments.Root`'s `onCommentAction("like" \| "unlike", node)`; disabled when that's unset. See [Per-comment interactions](#per-comment-interactions). |
| `Comments.ReplyButton` | `button` | `{ node }` | Calls `Comments.Root`'s `onCommentAction("reply", node)` — does not open a composer itself (see [Per-comment interactions](#per-comment-interactions)). Renders nothing when `onCommentAction` is unset. |
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
| `Likes.Button` | `button` | `{ liked, count, isBusy, isDisabled }` | Standalone like/unlike toggle for the post — no `Likes.Root` needed. Takes `liked`, `count`, `onLike`, `onUnlike`, `disabled?` as props (same "injected, not imported" contract as `Reply.Root`'s `session`/`onSubmit`). See [Liking the post](#liking-the-post). |
| `Likes.Avatars` | `div` | `{ count, total }` | One entry per liker. With a child template it repeats it; with no children it renders a default `<img>` stack. Extra prop: `max?: number` to cap how many render. |
| `Likes.Avatar` | `img` | `{ like, actor }` | A single liker's avatar, `alt`-labelled and lazy-loaded. Renders nothing when they have no avatar. |
| `Likes.Loading` | `div` | `{}` | Renders only while fetching. |
| `Likes.Empty` | `div` | `{}` | Renders only once loaded with zero likes. |
| `Likes.Error` | `div` (`role="alert"`) | `{ error }` | Renders only on failure. |

> **Totals caveat.** `getLikes` returns pages of actors, not a grand total, so `Likes.Count` reports the number actually *fetched* (capped by `pageSize × maxPages`), which can be fewer than the post's real like count. For the true like number, read `stats.likeCount` from `Comments.Stats` / `useComments` — the demo does exactly this (avatars from `Likes`, the count from the thread's stats).

### `Reply.*`

| Part | Default element | State | Notes |
|------|-----------------|-------|-------|
| `Reply.Root` | `form` | `{ status, isSignedIn, isSubmitting, isError }` | Provider + container. Takes `session` (`{ did, handle, displayName? } \| null`) and `onSubmit(text) => Promise<void>` as props, plus `onSubmitted?: () => void` and `defaultValue?: string`. Renders a `<form>` so both `Reply.Submit` and pressing Enter in `Reply.Field` submit; the native submit is intercepted. |
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
| `Editor.Root` | `form` | `{ status, isLoading, isDirty, isSaving, isSaved, isError }` | Provider + container. Takes `document` (`{ title, markdown } \| null` — `null` means still loading) and `onSave(fields) => Promise<void>` as props. A NEW `document` object resets the fields; re-rendering with the SAME reference never clobbers unsaved edits. Renders a `<form>` so both `Editor.Save` and a native submit trigger `save()`. |
| `Editor.Title` | `input` | `{ value, isLoading, isSaving }` | The title, bound to `Editor.Root`'s state. Disabled while loading. |
| `Editor.Body` | `textarea` | `{ value, isLoading, isSaving }` | A headless SLOT, not an editor. By default a plain `<textarea>` bound to the markdown string. Its `render` prop is DIFFERENT from every other part's: `render={(slot) => ...}` where `slot` is `{ value, onChange }` for the markdown string directly — not this library's usual `(props, state) => element` DOM-props contract — because a real rich-text editor component has nothing to do with spread DOM attributes. This is the mount point for e.g. Tiptap; `@hedgerow/react` never ships an editor. |
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
      <Editor.Body render={(slot) => <TiptapMarkdownEditor value={slot.value} onChange={slot.onChange} />} />
      <Editor.Save />
      <Editor.Status />
    </Editor.Root>
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

`Comments.LikeButton` and `Comments.ReplyButton` are the per-comment counterparts, driven by two props on `Comments.Root`:

```tsx
<Comments.Root
  post={post}
  onCommentAction={(action, node) => {
    if (action === "like") return reader.like({ uri: node.uri, cid: node.cid }).then(() => {});
    if (action === "unlike") return likedUris.get(node.uri)?.then((uri) => uri && reader.unlike(uri));
    if (action === "reply") setReplyTarget({ uri: node.uri, cid: node.cid, handle: node.author.handle });
  }}
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

`Comments.ReplyButton` does **not** open its own composer — it just calls `onCommentAction("reply", node)` so you can retarget your existing `Reply.*` composer's `parent` at `{ uri: node.uri, cid: node.cid }` (keeping `root` as the thread root). One composer instance, retargeted, not one mounted per comment — see the demo's `CommentThread.tsx` for the full "Replying to @handle · Cancel" pattern. Both parts are disabled/unrendered whenever `onCommentAction` is omitted, so this whole surface stays inert (and `@hedgerow/react` stays auth-free) until you wire it up.

### Optimistic replies

`@hedgerow/reader`'s `createReply()` (or your own write) already returns the new reply's real `{ uri, cid }` once the write succeeds — well before any AppView has indexed it. `useComments()`'s `addOptimisticReply({ ref, parentUri, text, author })` inserts that reply into the tree **immediately**, keyed by its own real uri (no temp-id reconciliation), nested under `parentUri` (the root post's uri for a top-level reply, or an existing comment's uri for a nested one):

```tsx
const { addOptimisticReply, refetch } = useCommentsContext();

async function handleSubmit(text: string) {
  const ref = await reader.createReply({ root, parent, text });
  addOptimisticReply({ ref, parentUri: parent.uri, text, author: session });
  // Give the AppView a few seconds to index it, confirming/unconfirming as
  // each refetch lands — see DeliveryState below. Not awaited: the reply is
  // already visible, no reason to keep the composer in a submitting state.
  [2000, 4000, 6000].forEach((ms) => setTimeout(refetch, ms));
}
```

The node then moves through `Comments.Item`'s `data-state`, exposed as `state.deliveryState` too:

- **`pending`** — the write succeeded; no `refetch()` has found it in the real tree yet.
- **`confirmed`** — a `refetch()` just found it (briefly, ~1.2s, as a hand-off signal before the attribute disappears — it's now just an ordinary node).
- **`unconfirmed`** — `optimisticGiveUpAfter` (default 3) refetches passed without the AppView indexing it. **The node keeps showing regardless** — this state exists specifically so a reply the write actually succeeded for never just vanishes.

`Comments.Item` also carries `data-entering` for exactly one frame after it first mounts — true for a brand new optimistic insert, and for any node appearing for the first time on a revalidate (existing rows don't re-trigger it, since React keys each item by uri and only a genuinely new one gets a fresh mount). Style the "before" look on `[data-entering]` and let a `transition` animate to the resting style once it's removed:

```css
.comment {
  opacity: 1;
  transition: opacity 0.3s ease;
}
.comment[data-entering] { opacity: 0; }
.comment[data-state="pending"],
.comment[data-state="unconfirmed"] { opacity: 0.6; }
.comment[data-state="pending"]::after { content: "Sending…"; }
.comment[data-state="unconfirmed"]::after { content: "Not visible to others yet"; }
```

v1 ships entering-only transitions (no exit animation — a confirmed node just keeps existing, so there's nothing to animate out of the DOM).

## Hooks

The components are a thin shell over three hooks. Use them directly when you want your own markup entirely.

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
  optimisticGiveUpAfter?: number;        // refetches before a pending optimistic reply flips to "unconfirmed" (default 3)
}

interface UseCommentsReturn {
  status: "idle" | "loading" | "success" | "error";
  data: ThreadResult | undefined;
  error: unknown;
  root: CommentNode | undefined;         // the root post node (may be a stub)
  stats: PostStats | undefined;          // root-post engagement counts
  postUrl: string | undefined;           // "reply on Bluesky" target
  comments: CommentNode[];               // top-level comments, sorted + filtered + optimistic replies merged in
  sort: SortOrder;
  setSort: (sort: SortOrder) => void;    // re-sorts client-side, no refetch
  refetch: () => void;                   // also drives the optimistic confirm/unconfirm sweep — see Optimistic replies
  isIdle: boolean; isLoading: boolean; isSuccess: boolean; isError: boolean;
  isEmpty: boolean;                      // loaded with zero visible comments
  addOptimisticReply: (input: OptimisticReplyInput) => void; // see Optimistic replies
  deliveryStateOf: (uri: string) => "pending" | "confirmed" | "unconfirmed" | undefined; // Comments.Item's data-state source
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

```ts
function useReply(options: UseReplyOptions): UseReplyReturn;

interface UseReplyOptions {
  session: { did: string; handle: string; displayName?: string } | null;
  onSubmit: (text: string) => Promise<void>;
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
  status: "loading" | "editing" | "dirty" | "saving" | "saved" | "error";
  isLoading: boolean; isDirty: boolean; isSaving: boolean; isError: boolean;
  error: unknown;
  title: string; markdown: string;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  save: () => Promise<void>;             // no-ops unless status is "dirty"
}
```

Like `useReply`, `useEditor` fetches nothing — `document`/`onSave` are where you plug in the actual read/write (the demo uses `@hedgerow/publish`'s read core + `@hedgerow/reader`'s `asPublisher()`).

There's also `useCommentNode()` — the current `CommentNode` inside a `<Comments.Item>`, the escape hatch for building your own parts — and the context hooks `useCommentsContext()` / `useLikesContext()` / `useReplyContext()` / `useEditorContext()` (throw if used outside their respective `Root`).
`useLikeButton(options)` is the engine behind `Likes.Button`/`Comments.LikeButton` — same shape as `useReply`: `{ liked, count, onLike, onUnlike, disabled? }` in, `{ liked, count, isBusy, isDisabled, toggle }` out, with the optimistic ±1 count adjustment and rollback-on-rejection built in. Use it directly for fully custom like UI.

There's also `useCommentNode()` — the current `CommentNode` inside a `<Comments.Item>`, the escape hatch for building your own parts — and the context hooks `useCommentsContext()` / `useLikesContext()` / `useReplyContext()` (throw if used outside their respective `Root`).

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
