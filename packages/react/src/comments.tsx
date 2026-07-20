// The `Comments.*` namespace: composable, unstyled parts over `useComments`.
// Every part follows the same three rules, so the whole surface is predictable:
//   1. It renders a sensible default element you can swap via `render`.
//   2. It exposes its runtime state to `render` / `className` / `style` functions.
//   3. It reflects that state as `data-*` attributes for pure-CSS styling.
//
// Nothing here ships a single style. Deleted/blocked replies never crash — they
// arrive as placeholder nodes and render through `Comments.Fallback`. Moderation
// labels are surfaced (data-attribute + `Comments.Labels`) but never hidden;
// filtering is the consumer's call via `<Comments.Root filter>`.
import * as React from "react";
import type { CommentNode, Comment, Label, PostStats, SortOrder } from "@hedgerow/comments";
import { renderElement, dataAttrs, chainHandlers, type HeadlessProps, type PartProps } from "./render";
import {
  CommentsRootContext,
  CommentItemContext,
  useCommentsContext,
  useCommentItemContext,
  useOptionalCommentItem,
  type CommentsItemContextValue,
  type CommentsContextValue,
} from "./context";
import { useComments, type DeliveryState, type UseCommentsOptions, type UseCommentsReturn } from "./useComments";
import { useLikeButton } from "./useLikeButton";

// `PartProps` now lives in ./render (shared infra, not comments-specific) —
// re-exported here so existing imports of it from "./comments" keep working.
export type { PartProps };

/** Stable React key for a node (its at:// URI is unique across the tree). */
const keyOf = (node: CommentNode): string => node.uri;

/**
 * Whether the tree has ever successfully rendered a population before now —
 * read once by each `Comments.Item` at its OWN first render (a lazy
 * `useState` initializer, so it's captured exactly once per item instance) to
 * decide whether this particular mount is part of the tree's very first
 * appearance (never animated — see `Root`'s tracking below, and `Item`'s
 * `isEntering` state) or a genuinely new node showing up later (animated).
 * Deliberately NOT part of `CommentsContextValue`/`useComments` — this is
 * pure entry-animation bookkeeping, private to this file. The default value
 * (`true`) only matters for an `Item` rendered without a `Root` at all, which
 * `useCommentItemContext`'s own guard already makes impossible in practice.
 */
const SettledRefContext = React.createContext<{ current: boolean }>({ current: true });

// ── Root ─────────────────────────────────────────────────────────────────────

export interface CommentsRootState {
  status: UseCommentsReturn["status"];
  isEmpty: boolean;
  count: number;
}

export interface CommentsRootProps
  extends Omit<UseCommentsOptions, "sort">,
    HeadlessProps<CommentsRootState>,
    Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style" | "children"> {
  /** Initial reply order (uncontrolled). */
  sort?: SortOrder;
  /** Like `node`. A rejection rolls `Comments.LikeButton`'s optimistic toggle back. Omitting this (along with `onUnlikeComment`) leaves `Comments.LikeButton` disabled — this package never imports `@hedgerow/reader` or any auth library, so the app supplies the actual write. */
  onLikeComment?: (node: Comment) => void | Promise<void>;
  /** Unlike `node`. A rejection rolls the optimistic toggle back. */
  onUnlikeComment?: (node: Comment) => void | Promise<void>;
  /** "Reply to this comment" was triggered. `Comments.ReplyButton` renders only when this is set — retarget your own `Reply.*` composer's `parent` at `{ uri: node.uri, cid: node.cid }` from here (keeping `root` as the thread root). */
  onReplyToComment?: (node: Comment) => void | Promise<void>;
  /** Report whether the reader has already liked `node` — drives `Comments.LikeButton`'s toggle state. `undefined` = unknown. */
  isCommentLiked?: (node: Comment) => boolean | undefined;
}

/**
 * Provider + container. Runs the state machine and exposes it to every nested
 * part via context. Renders a `<div>` by default; reflects status as
 * `data-status` / `data-loading` / `data-error` / `data-empty`.
 */
export const Root = React.forwardRef<HTMLDivElement, CommentsRootProps>(function CommentsRoot(props, ref) {
  const {
    post,
    sort,
    maxDepth,
    filter,
    initialData,
    data,
    onRefetch,
    appView,
    fetchImpl,
    cacheTtlMs,
    optimisticGiveUpAfter,
    revalidateOnMount,
    confirmRetryDelays,
    onLikeComment,
    onUnlikeComment,
    onReplyToComment,
    isCommentLiked,
    render,
    className,
    style,
    children,
    ...rest
  } = props;

  const value = useComments({
    post,
    ...(sort !== undefined ? { sort } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(filter !== undefined ? { filter } : {}),
    ...(initialData !== undefined ? { initialData } : {}),
    // `data`/`onRefetch` forwarded only when the caller actually used
    // controlled mode — `useComments` distinguishes "key present" from
    // "key present with value undefined" (see its own doc comment), so this
    // spread must not manufacture a `data: undefined` key on every render.
    ...("data" in props ? { data } : {}),
    ...(onRefetch !== undefined ? { onRefetch } : {}),
    ...(appView !== undefined ? { appView } : {}),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    ...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}),
    ...(optimisticGiveUpAfter !== undefined ? { optimisticGiveUpAfter } : {}),
    ...(revalidateOnMount !== undefined ? { revalidateOnMount } : {}),
    ...(confirmRetryDelays !== undefined ? { confirmRetryDelays } : {}),
  });

  const state: CommentsRootState = {
    status: value.status,
    isEmpty: value.isEmpty,
    count: value.comments.length,
  };

  const element = renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      // Announce to assistive tech that the region is fetching (cleared once
      // loaded); consumer can override via `rest`.
      "aria-busy": value.isLoading || undefined,
      ...rest,
      ...dataAttrs({
        status: value.status,
        loading: value.isLoading,
        revalidating: value.isRevalidating,
        error: value.isError,
        empty: value.isEmpty,
        count: value.comments.length,
      }),
      children,
    },
  });

  // Tracks "has the tree ever committed a population before now" — starts
  // `false` regardless of whether this mount is seeded (`initialData`/`data`)
  // or empty-then-fetched, so the very FIRST batch of `Comments.Item`s (seeded
  // synchronously or arriving from the first successful fetch — either way,
  // still the first commit) reads `false` and suppresses `data-entering`.
  // Flips permanently `true` in an effect once `isSuccess`, so any LATER
  // commit's genuinely-new items animate in normally. Never flipped back —
  // an error or a subsequent loading state doesn't un-settle the tree.
  const settledRef = React.useRef(false);
  React.useEffect(() => {
    if (value.isSuccess) settledRef.current = true;
  }, [value.isSuccess]);

  return (
    <Provider
      value={value}
      onLikeComment={onLikeComment}
      onUnlikeComment={onUnlikeComment}
      onReplyToComment={onReplyToComment}
      isCommentLiked={isCommentLiked}
    >
      <SettledRefContext.Provider value={settledRef}>{element}</SettledRefContext.Provider>
    </Provider>
  );
});

// ── Provider (context bridge for a hand-rolled tree, SLIMS-70) ─────────────────

export interface CommentsProviderProps {
  /** The return of your OWN `useComments()` call — lets you mount `Comments.*` leaf parts, or a fully custom tree via `Comments.ItemScope`, without `Comments.Root` owning the fetch/state machine itself. */
  value: UseCommentsReturn;
  /** Same per-comment UI callbacks `Comments.Root` takes — see its own doc comments. */
  onLikeComment?: (node: Comment) => void | Promise<void>;
  onUnlikeComment?: (node: Comment) => void | Promise<void>;
  onReplyToComment?: (node: Comment) => void | Promise<void>;
  isCommentLiked?: (node: Comment) => boolean | undefined;
  children?: React.ReactNode;
}

/**
 * The context half of `Comments.Root`, without the fetch/render half — for
 * consumers who already call `useComments()` themselves (e.g. to layer it
 * under their own routing/suspense/TanStack Query setup) and just want to
 * mount `Comments.*` leaf parts against that same state. Pair with
 * `Comments.ItemScope` to build a fully custom per-comment tree.
 */
export function Provider({
  value,
  onLikeComment,
  onUnlikeComment,
  onReplyToComment,
  isCommentLiked,
  children,
}: CommentsProviderProps): React.ReactElement {
  const contextValue: CommentsContextValue = {
    ...value,
    onLikeComment,
    onUnlikeComment,
    onReplyToComment,
    isCommentLiked,
  };
  return <CommentsRootContext.Provider value={contextValue}>{children}</CommentsRootContext.Provider>;
}

// ── List + recursion ─────────────────────────────────────────────────────────

/** Wrap one node's `<Comments.Item>` template in its per-node context. */
function ItemProvider(props: CommentsItemContextValue): React.ReactElement {
  return (
    <CommentItemContext.Provider value={props}>{props.template}</CommentItemContext.Provider>
  );
}

export interface CommentsItemScopeProps {
  /** The node this scope's leaf parts (`Comments.Author`, `Comments.Content`, …) and any nested `Comments.Replies` read. */
  node: CommentNode;
  /** Nesting level. Default 0. */
  depth?: number;
  /** Position among siblings — cosmetic (e.g. for a `render` prop that needs it), not used internally beyond that. Default 0. */
  index?: number;
  children?: React.ReactNode;
}

/**
 * The item half of `Comments.Provider` — mount a single node (and, via any
 * `Comments.Replies` inside `children`, its own recursive subtree) at an
 * arbitrary point in your own markup, outside `Comments.List`/`Comments.Item`'s
 * built-in recursion. `children` doubles as the template `Comments.Replies`
 * repeats for this node's own replies, same as `Comments.Item`'s children do.
 */
export function ItemScope({ node, depth = 0, index = 0, children }: CommentsItemScopeProps): React.ReactElement {
  return <ItemProvider node={node} depth={depth} index={index} template={children} />;
}

export interface CommentsListState {
  count: number;
  isEmpty: boolean;
}

export type CommentsListProps = PartProps<CommentsListState, "div">;

/**
 * Renders the top-level comments. Its single child is treated as a *template*
 * (`<Comments.Item>…</Comments.Item>`) and rendered once per comment. Default
 * element `<div>`.
 */
export const List = React.forwardRef<HTMLDivElement, CommentsListProps>(function CommentsList(
  { render, className, style, children, ...rest },
  ref,
) {
  const { comments } = useCommentsContext();
  const state: CommentsListState = { count: comments.length, isEmpty: comments.length === 0 };

  const items = comments.map((node, index) => (
    <ItemProvider key={keyOf(node)} node={node} depth={0} index={index} template={children} />
  ));

  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      // `role="list"` keeps the group announced as a list even though the
      // default element is a plain <div>; consumer can override via `rest`.
      role: "list",
      ...rest,
      ...dataAttrs({ empty: state.isEmpty, count: state.count }),
      children: items,
    },
  });
});

export interface CommentsItemState {
  node: CommentNode;
  depth: number;
  index: number;
  /** "comment" | "blocked" | "notFound". */
  kind: CommentNode["type"];
  isComment: boolean;
  isStub: boolean;
  hasReplies: boolean;
  labels: Label[];
  /** "pending" | "confirmed" | "unconfirmed" for an optimistically-inserted reply; undefined for an ordinary fetched node. See `useComments`'s `DeliveryState`. */
  deliveryState: DeliveryState | undefined;
  /**
   * True for exactly one frame after this row first mounts, EXCEPT for the
   * tree's very first population (seeded or freshly fetched) — that initial
   * batch never animates (and SSR output never carries `data-entering`).
   * Only a node appearing after the tree has already shown data once — a
   * fresh optimistic insert, or a node showing up for the first time on a
   * revalidate — gets it. Pairs with `data-entering` for a plain CSS entry
   * transition: style `[data-entering]` as the "before" look, the resting
   * style as the "after" one, and a `transition` does the rest once the
   * attribute is removed next frame.
   */
  isEntering: boolean;
}

export type CommentsItemProps = PartProps<CommentsItemState, "div">;

/**
 * A single comment row (also the template `<Comments.List>`/`<Comments.Replies>`
 * repeat). Reflects `data-depth`, one of `data-comment`/`data-blocked`/
 * `data-not-found`, `data-labeled`, `data-has-replies`, `data-delivery`
 * (optimistic delivery state), and `data-entering` (one-frame entry-transition
 * hook — see `CommentsItemState.isEntering`).
 */
export const Item = React.forwardRef<HTMLDivElement, CommentsItemProps>(function CommentItem(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node, depth, index } = useCommentItemContext();
  const { deliveryStateOf } = useCommentsContext();
  const isComment = node.type === "comment";
  const labels = isComment ? (node as Comment).labels : [];
  const hasReplies = isComment && (node as Comment).replies.length > 0;

  // Captured once at THIS item's own first render (see SettledRefContext's
  // doc comment) — a node that's already been showing keeps the same
  // component instance (React keys each item by its uri, see keyOf below) so
  // this state stays whatever it started as; only a truly new mount reads a
  // fresh value here.
  const settledRef = React.useContext(SettledRefContext);
  // NOT negated: `settledRef.current` is `false` exactly while this render is
  // (part of) the tree's first-ever population — reading it directly is what
  // suppresses entering for that population and enables it for anything
  // mounting afterwards (see SettledRefContext's own doc comment).
  const [isEntering, setIsEntering] = React.useState(() => settledRef.current);
  React.useEffect(() => {
    if (!isEntering) return;
    // Double-rAF, not a single one: a single `requestAnimationFrame` can fire
    // before the browser has actually PAINTED the "entering" (before) style —
    // especially for a row that mounts synchronously inside a click handler
    // (an optimistic insert), where there's no other yield to the browser in
    // between. The first rAF waits for the next frame (style recalculated);
    // clearing inside a SECOND, nested rAF guarantees a paint has already
    // happened with the "before" style before the "after" style is committed,
    // so the CSS transition reliably has something to animate FROM.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setIsEntering(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state: CommentsItemState = {
    node,
    depth,
    index,
    kind: node.type,
    isComment,
    isStub: !isComment,
    hasReplies,
    labels,
    deliveryState: deliveryStateOf(node.uri),
    isEntering,
  };

  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      // Pairs with the `role="list"` on List/Replies so each row is announced
      // as a list item, whatever element the consumer renders it as.
      role: "listitem",
      ...rest,
      ...dataAttrs({
        depth,
        comment: node.type === "comment",
        blocked: node.type === "blocked",
        "not-found": node.type === "notFound",
        labeled: labels.length > 0,
        "has-replies": hasReplies,
        delivery: state.deliveryState,
        entering: isEntering,
      }),
      children,
    },
  });
});

export interface CommentsRepliesState {
  count: number;
  depth: number;
}

/** `children` isn't accepted — `Comments.Replies` always repeats the enclosing `Comments.Item`'s own template (`Comments.ItemScope`'s children), never a caller-supplied one. */
export type CommentsRepliesProps = Omit<PartProps<CommentsRepliesState, "div">, "children">;

/**
 * Recursively renders the current comment's replies using the same item
 * template. Renders nothing when the node is a stub or has no replies.
 */
export const Replies = React.forwardRef<HTMLDivElement, CommentsRepliesProps>(function CommentsReplies(
  { render, className, style, ...rest },
  ref,
) {
  const { node, depth, template } = useCommentItemContext();
  if (node.type !== "comment" || node.replies.length === 0) return null;

  const state: CommentsRepliesState = { count: node.replies.length, depth: depth + 1 };
  const items = node.replies.map((child, index) => (
    <ItemProvider key={keyOf(child)} node={child} depth={depth + 1} index={index} template={template} />
  ));

  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      // A nested reply list — same list semantics as the top-level List, so the
      // recursed listitems aren't orphaned.
      role: "list",
      ...rest,
      ...dataAttrs({ depth: depth + 1, count: state.count }),
      children: items,
    },
  });
});

// ── Leaf parts (read the current item) ───────────────────────────────────────

export interface CommentsAuthorState {
  author: Comment["author"];
  node: Comment;
}

export type CommentsAuthorProps = PartProps<CommentsAuthorState, "span">;

/** The comment author. Defaults to displayName (falling back to handle). */
export const Author = React.forwardRef<HTMLSpanElement, CommentsAuthorProps>(function CommentsAuthor(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment") return null;
  const state: CommentsAuthorState = { author: node.author, node };
  return renderElement("span", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      ...rest,
      ...dataAttrs({ handle: node.author.handle }),
      children: children ?? (node.author.displayName || node.author.handle),
    },
  });
});

export type CommentsAvatarProps = PartProps<CommentsAuthorState, "img">;

/** The author's avatar `<img>`. Renders nothing when there's no avatar. */
export const Avatar = React.forwardRef<HTMLImageElement, CommentsAvatarProps>(function CommentsAvatar(
  { render, className, style, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment" || !node.author.avatar) return null;
  const state: CommentsAuthorState = { author: node.author, node };
  return renderElement("img", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      src: node.author.avatar,
      alt: node.author.displayName || node.author.handle,
      loading: "lazy",
      ...rest,
    },
  });
});

export interface CommentsContentState {
  text: string;
  node: Comment;
}

export type CommentsContentProps = PartProps<CommentsContentState, "div">;

/** The comment body text. Defaults to the post text. */
export const Content = React.forwardRef<HTMLDivElement, CommentsContentProps>(function CommentsContent(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment") return null;
  const state: CommentsContentState = { text: node.text, node };
  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: { ...rest, children: children ?? node.text },
  });
});

export interface CommentsTimestampState {
  date: Date;
  node: Comment;
}

export interface CommentsTimestampProps extends PartProps<CommentsTimestampState, "time"> {
  /** Format the label. Defaults to a locale date string. */
  format?: (date: Date) => string;
}

const defaultDateFormat = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);

/**
 * A `<time>` with a machine-readable `dateTime` and a formatted label.
 *
 * The default label (`Intl.DateTimeFormat` with no explicit `timeZone`) uses
 * the *reader's* local timezone — which differs between server and client
 * whenever they're in different zones, so the server-rendered label and the
 * client's first render can legitimately mismatch and trigger a hydration
 * warning. `dateTime` itself never mismatches (`node.createdAt` is a fixed
 * ISO string), only the human-readable text. If you hit this, either accept
 * the one-time client-side correction (React repairs mismatched text content
 * on its own), or pass a `format` that's stable across server/client — a
 * fixed UTC format, or a relative-time label recomputed client-side only.
 */
export const Timestamp = React.forwardRef<HTMLTimeElement, CommentsTimestampProps>(
  function CommentsTimestamp({ render, className, style, children, format, ...rest }, ref) {
    const { node } = useCommentItemContext();
    if (node.type !== "comment") return null;
    const date = new Date(node.createdAt);
    const state: CommentsTimestampState = { date, node };
    const label = children ?? (format ?? defaultDateFormat)(date);
    return renderElement("time", {
      state,
      render,
      className,
      style,
      ref,
      props: { ...rest, dateTime: node.createdAt, children: label },
    });
  },
);

export interface CommentsLikeCountState {
  count: number;
  node: Comment;
}

export type CommentsLikeCountProps = PartProps<CommentsLikeCountState, "span">;

/** The comment's own like count. Defaults to the number. */
export const LikeCount = React.forwardRef<HTMLSpanElement, CommentsLikeCountProps>(function CommentsLikeCount(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment") return null;
  const state: CommentsLikeCountState = { count: node.likeCount, node };
  return renderElement("span", {
    state,
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ count: node.likeCount }), children: children ?? node.likeCount },
  });
});

export interface CommentsLikeButtonState {
  node: Comment;
  liked: boolean | undefined;
  count: number;
  isBusy: boolean;
  isDisabled: boolean;
}

/** `onClick`/`disabled` aren't accepted directly — both are computed from `Comments.Root`'s `onLikeComment`/`onUnlikeComment`/`isCommentLiked`. Use `render` to reach the underlying element (its click handler still chains with the computed one — see `chainHandlers`). */
export type CommentsLikeButtonProps = Omit<PartProps<CommentsLikeButtonState, "button">, "onClick" | "disabled">;

/**
 * Like/unlike toggle for THIS comment (as opposed to `Likes.Button`, which is
 * for the root post). Reads `node` from the enclosing `Comments.Item` and
 * `onLikeComment`/`onUnlikeComment`/`isCommentLiked` from `Comments.Root` —
 * disabled unless BOTH like handlers are set (e.g. no reader session), same
 * "injected, never imported" auth contract as the rest of this package.
 * Reflects `data-liked` / `data-busy` / `data-disabled`.
 */
export const LikeButton = React.forwardRef<HTMLButtonElement, CommentsLikeButtonProps>(
  function CommentsLikeButton({ render, className, style, children, ...rest }, ref) {
    const { node } = useCommentItemContext();
    const { onLikeComment, onUnlikeComment, isCommentLiked } = useCommentsContext();
    const comment = node.type === "comment" ? node : undefined;

    // Hooks run unconditionally (Rules of Hooks) — the "not a real comment"
    // case is handled by returning null below, after every hook has run.
    const value = useLikeButton({
      liked: comment ? isCommentLiked?.(comment) : undefined,
      count: comment?.likeCount ?? 0,
      onLike: () => (comment ? onLikeComment?.(comment) : undefined),
      onUnlike: () => (comment ? onUnlikeComment?.(comment) : undefined),
      disabled: !onLikeComment || !onUnlikeComment || !comment,
    });

    if (!comment) return null;
    const state: CommentsLikeButtonState = {
      node: comment,
      liked: value.liked,
      count: value.count,
      isBusy: value.isBusy,
      isDisabled: value.isDisabled,
    };
    return renderElement("button", {
      state,
      render,
      className,
      style,
      ref,
      props: {
        type: "button",
        ...rest,
        disabled: value.isDisabled,
        "aria-pressed": value.liked === true,
        onClick: chainHandlers(() => void value.toggle(), (rest as { onClick?: () => void }).onClick),
        ...dataAttrs({ liked: value.liked === true, busy: value.isBusy, disabled: value.isDisabled }),
        children: children ?? (value.liked ? `♥ ${value.count}` : `♡ ${value.count}`),
      },
    });
  },
);

export interface CommentsReplyButtonState {
  node: Comment;
}

/** `onClick` isn't accepted directly — it's computed from `Comments.Root`'s `onReplyToComment`. Use `render` to reach the underlying element (its click handler still chains with the computed one). */
export type CommentsReplyButtonProps = Omit<PartProps<CommentsReplyButtonState, "button">, "onClick">;

/**
 * "Reply to this comment" trigger — does NOT itself open a composer (reuse
 * `Reply.*` for that, one instance, retargeted). Clicking it just calls
 * `Comments.Root`'s `onReplyToComment(node)`, so the app can point its
 * existing composer's `parent` at this comment's strongRef (`node.uri`/
 * `node.cid`) while `root` stays the thread root. Renders nothing when
 * `onReplyToComment` is omitted — there'd be nothing for a click to do.
 */
export const ReplyButton = React.forwardRef<HTMLButtonElement, CommentsReplyButtonProps>(
  function CommentsReplyButton({ render, className, style, children, ...rest }, ref) {
    const { node } = useCommentItemContext();
    const { onReplyToComment } = useCommentsContext();
    if (node.type !== "comment" || !onReplyToComment) return null;
    const state: CommentsReplyButtonState = { node };
    return renderElement("button", {
      state,
      render,
      className,
      style,
      ref,
      props: {
        type: "button",
        ...rest,
        onClick: chainHandlers(() => void onReplyToComment(node), (rest as { onClick?: () => void }).onClick),
        children: children ?? "Reply",
      },
    });
  },
);

export interface CommentsLabelsState {
  labels: Label[];
}

export type CommentsLabelsProps = PartProps<CommentsLabelsState, "span">;

/**
 * Moderation labels on the comment (post + author, merged upstream). Renders
 * nothing when there are none. Never a filter — surfacing only. Defaults to the
 * comma-joined label values; use `render` for chips.
 */
export const Labels = React.forwardRef<HTMLSpanElement, CommentsLabelsProps>(function CommentsLabels(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  const labels = node.type === "comment" ? node.labels : [];
  if (labels.length === 0) return null;
  const state: CommentsLabelsState = { labels };
  return renderElement("span", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      ...rest,
      ...dataAttrs({ count: labels.length, values: labels.map((l) => l.val).join(" ") }),
      children: children ?? labels.map((l) => l.val).join(", "),
    },
  });
});

export interface CommentsFallbackState {
  kind: "blocked" | "notFound";
  node: CommentNode;
}

export type CommentsFallbackProps = PartProps<CommentsFallbackState, "div">;

/**
 * Placeholder for a deleted (`notFound`) or `blocked` reply. Renders only for
 * stub nodes; real comments render nothing here. Default copy is generic — pass
 * children or `render` to customize per kind (available on `state.kind`).
 */
export const Fallback = React.forwardRef<HTMLDivElement, CommentsFallbackProps>(function CommentsFallback(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type === "comment") return null;
  const kind = node.type === "blocked" ? "blocked" : "notFound";
  const state: CommentsFallbackState = { kind, node };
  const defaultText = kind === "blocked" ? "Blocked reply" : "This reply was deleted";
  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ kind }), children: children ?? defaultText },
  });
});

// ── Post-level & status parts (read the root) ────────────────────────────────

export interface CommentsStatsState extends PostStats {
  postUrl: string | undefined;
}

export type CommentsStatsProps = PartProps<CommentsStatsState, "div">;

/**
 * Root-post engagement counts, exposed to `render`/children. Reflects each
 * count as a `data-*` attribute so a pure-CSS summary is possible. Renders
 * whatever children you give it (compose your own "12 likes · 4 replies").
 */
export const Stats = React.forwardRef<HTMLDivElement, CommentsStatsProps>(function CommentsStats(
  { render, className, style, children, ...rest },
  ref,
) {
  const { stats, postUrl } = useCommentsContext();
  const resolved: PostStats = stats ?? { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 };
  const state: CommentsStatsState = { ...resolved, postUrl };
  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      ...rest,
      ...dataAttrs({
        "like-count": resolved.likeCount,
        "reply-count": resolved.replyCount,
        "repost-count": resolved.repostCount,
        "quote-count": resolved.quoteCount,
      }),
      children,
    },
  });
});

export interface CommentsReplyLinkState {
  href: string;
  /** The comment being replied to, when the link sits inside an item. */
  node: CommentNode | undefined;
  /** True when the link targets the root post rather than a specific comment. */
  isRoot: boolean;
}

export type CommentsReplyLinkProps = PartProps<CommentsReplyLinkState, "a">;

/**
 * The "reply on Bluesky" affordance. Inside a `<Comments.Item>` it links to that
 * comment; otherwise to the root post. Opens Bluesky in a new tab. Renders
 * nothing until a URL is available.
 */
export const ReplyLink = React.forwardRef<HTMLAnchorElement, CommentsReplyLinkProps>(
  function CommentsReplyLink({ render, className, style, children, ...rest }, ref) {
    const root = useCommentsContext();
    const item = useOptionalCommentItem();
    const itemUrl = item && item.node.type === "comment" ? item.node.url : undefined;
    const href = itemUrl ?? root.postUrl;
    if (!href) return null;

    const state: CommentsReplyLinkState = { href, node: item?.node, isRoot: !itemUrl };
    return renderElement("a", {
      state,
      render,
      className,
      style,
      ref,
      props: {
        href,
        target: "_blank",
        rel: "noopener noreferrer",
        ...rest,
        ...dataAttrs({ root: !itemUrl }),
        children: children ?? "Reply on Bluesky",
      },
    });
  },
);

// ── Conditional status wrappers ──────────────────────────────────────────────

export type CommentsLoadingProps = PartProps<Record<string, never>, "div">;

/** Renders only while the initial fetch is in flight. */
export const Loading = React.forwardRef<HTMLDivElement, CommentsLoadingProps>(function CommentsLoading(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isLoading } = useCommentsContext();
  if (!isLoading) return null;
  return renderElement("div", {
    state: {},
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ loading: true }), children },
  });
});

export interface CommentsErrorState {
  error: unknown;
}

export type CommentsErrorProps = PartProps<CommentsErrorState, "div">;

/** Renders only when the fetch failed; exposes the error to `render`/children. */
export const ErrorMessage = React.forwardRef<HTMLDivElement, CommentsErrorProps>(
  function CommentsError({ render, className, style, children, ...rest }, ref) {
    const { isError, error } = useCommentsContext();
    if (!isError) return null;
    const state: CommentsErrorState = { error };
    return renderElement("div", {
      state,
      render,
      className,
      style,
      ref,
      props: { role: "alert", ...rest, ...dataAttrs({ error: true }), children },
    });
  },
);

export type CommentsEmptyProps = PartProps<Record<string, never>, "div">;

/** Renders only once loaded with zero visible comments. */
export const Empty = React.forwardRef<HTMLDivElement, CommentsEmptyProps>(function CommentsEmpty(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isEmpty } = useCommentsContext();
  if (!isEmpty) return null;
  return renderElement("div", {
    state: {},
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ empty: true }), children },
  });
});
