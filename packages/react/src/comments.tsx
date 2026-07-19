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
import { renderElement, dataAttrs, type HeadlessProps } from "./render";
import {
  CommentsRootContext,
  CommentItemContext,
  useCommentsContext,
  useCommentItemContext,
  useOptionalCommentItem,
  type CommentItemContextValue,
} from "./context";
import { useComments, type UseCommentsOptions, type UseCommentsReturn } from "./useComments";

/** Props common to a headless part rendering intrinsic element `Tag`. */
export type PartProps<State, Tag extends keyof React.JSX.IntrinsicElements> = HeadlessProps<State> &
  Omit<React.ComponentPropsWithoutRef<Tag>, "className" | "style" | "children">;

/** Stable React key for a node (its at:// URI is unique across the tree). */
const keyOf = (node: CommentNode): string => node.uri;

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
}

/**
 * Provider + container. Runs the state machine and exposes it to every nested
 * part via context. Renders a `<div>` by default; reflects status as
 * `data-status` / `data-loading` / `data-error` / `data-empty`.
 */
export const Root = React.forwardRef<HTMLDivElement, CommentsRootProps>(function CommentsRoot(
  { post, sort, maxDepth, filter, initialData, appView, fetchImpl, cacheTtlMs, render, className, style, children, ...rest },
  ref,
) {
  const value = useComments({
    post,
    ...(sort !== undefined ? { sort } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(filter !== undefined ? { filter } : {}),
    ...(initialData !== undefined ? { initialData } : {}),
    ...(appView !== undefined ? { appView } : {}),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    ...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}),
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
        error: value.isError,
        empty: value.isEmpty,
        count: value.comments.length,
      }),
      children,
    },
  });

  return <CommentsRootContext.Provider value={value}>{element}</CommentsRootContext.Provider>;
});

// ── List + recursion ─────────────────────────────────────────────────────────

/** Wrap one node's `<Comments.Item>` template in its per-node context. */
function ItemProvider(props: CommentItemContextValue): React.ReactElement {
  return (
    <CommentItemContext.Provider value={props}>{props.template}</CommentItemContext.Provider>
  );
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

export interface CommentItemState {
  node: CommentNode;
  depth: number;
  index: number;
  /** "comment" | "blocked" | "notFound". */
  kind: CommentNode["type"];
  isComment: boolean;
  isStub: boolean;
  hasReplies: boolean;
  labels: Label[];
}

export type CommentItemProps = PartProps<CommentItemState, "div">;

/**
 * A single comment row (also the template `<Comments.List>`/`<Comments.Replies>`
 * repeat). Reflects `data-depth`, one of `data-comment`/`data-blocked`/
 * `data-not-found`, `data-labeled`, and `data-has-replies`.
 */
export const Item = React.forwardRef<HTMLDivElement, CommentItemProps>(function CommentItem(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node, depth, index } = useCommentItemContext();
  const isComment = node.type === "comment";
  const labels = isComment ? (node as Comment).labels : [];
  const hasReplies = isComment && (node as Comment).replies.length > 0;

  const state: CommentItemState = {
    node,
    depth,
    index,
    kind: node.type,
    isComment,
    isStub: !isComment,
    hasReplies,
    labels,
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
      }),
      children,
    },
  });
});

export interface CommentsRepliesState {
  count: number;
  depth: number;
}

export type CommentsRepliesProps = PartProps<CommentsRepliesState, "div">;

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

export interface AuthorState {
  author: Comment["author"];
  node: Comment;
}

export type CommentsAuthorProps = PartProps<AuthorState, "span">;

/** The comment author. Defaults to displayName (falling back to handle). */
export const Author = React.forwardRef<HTMLSpanElement, CommentsAuthorProps>(function CommentsAuthor(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment") return null;
  const state: AuthorState = { author: node.author, node };
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

export type CommentsAvatarProps = PartProps<AuthorState, "img">;

/** The author's avatar `<img>`. Renders nothing when there's no avatar. */
export const Avatar = React.forwardRef<HTMLImageElement, CommentsAvatarProps>(function CommentsAvatar(
  { render, className, style, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment" || !node.author.avatar) return null;
  const state: AuthorState = { author: node.author, node };
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

export interface ContentState {
  text: string;
  node: Comment;
}

export type CommentsContentProps = PartProps<ContentState, "div">;

/** The comment body text. Defaults to the post text. */
export const Content = React.forwardRef<HTMLDivElement, CommentsContentProps>(function CommentsContent(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment") return null;
  const state: ContentState = { text: node.text, node };
  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: { ...rest, children: children ?? node.text },
  });
});

export interface TimestampState {
  date: Date;
  node: Comment;
}

export interface CommentsTimestampProps extends PartProps<TimestampState, "time"> {
  /** Format the label. Defaults to a locale date string. */
  format?: (date: Date) => string;
}

const defaultDateFormat = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);

/** A `<time>` with a machine-readable `dateTime` and a formatted label. */
export const Timestamp = React.forwardRef<HTMLTimeElement, CommentsTimestampProps>(
  function CommentsTimestamp({ render, className, style, children, format, ...rest }, ref) {
    const { node } = useCommentItemContext();
    if (node.type !== "comment") return null;
    const date = new Date(node.createdAt);
    const state: TimestampState = { date, node };
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

export interface LikesState {
  count: number;
  node: Comment;
}

export type CommentsLikesProps = PartProps<LikesState, "span">;

/** The comment's own like count. Defaults to the number. */
export const Likes = React.forwardRef<HTMLSpanElement, CommentsLikesProps>(function CommentsLikes(
  { render, className, style, children, ...rest },
  ref,
) {
  const { node } = useCommentItemContext();
  if (node.type !== "comment") return null;
  const state: LikesState = { count: node.likeCount, node };
  return renderElement("span", {
    state,
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ count: node.likeCount }), children: children ?? node.likeCount },
  });
});

export interface LabelsState {
  labels: Label[];
}

export type CommentsLabelsProps = PartProps<LabelsState, "span">;

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
  const state: LabelsState = { labels };
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

export interface FallbackState {
  kind: "blocked" | "notFound";
  node: CommentNode;
}

export type CommentsFallbackProps = PartProps<FallbackState, "div">;

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
  const state: FallbackState = { kind, node };
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

export interface StatsState extends PostStats {
  postUrl: string | undefined;
}

export type CommentsStatsProps = PartProps<StatsState, "div">;

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
  const state: StatsState = { ...resolved, postUrl };
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

export interface ReplyLinkState {
  href: string;
  /** The comment being replied to, when the link sits inside an item. */
  node: CommentNode | undefined;
  /** True when the link targets the root post rather than a specific comment. */
  isRoot: boolean;
}

export type CommentsReplyLinkProps = PartProps<ReplyLinkState, "a">;

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

    const state: ReplyLinkState = { href, node: item?.node, isRoot: !itemUrl };
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
        ...dataAttrs({ root: !itemUrl }),
        ...rest,
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
