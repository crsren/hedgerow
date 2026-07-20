// The `Likes.*` namespace: a small, focused family for rendering who liked a
// post and how many. Same headless rules as `Comments.*` — default element,
// state to `render`, `data-*` reflection, zero styles.
import * as React from "react";
import type { Like } from "@hedgerow/comments";
import { renderElement, dataAttrs, chainHandlers } from "./render";
import type { HeadlessProps } from "./render";
import { LikesRootContext, LikeItemContext, useLikesContext, useLikeItemContext } from "./context";
import { useLikes, type UseLikesOptions, type UseLikesReturn } from "./useLikes";
import { useLikeButton, type UseLikeButtonOptions } from "./useLikeButton";
import type { PartProps } from "./comments";

const keyOf = (like: Like): string => like.actor.did;

// ── Root ─────────────────────────────────────────────────────────────────────

export interface LikesRootState {
  status: UseLikesReturn["status"];
  total: number;
  isEmpty: boolean;
}

export interface LikesRootProps
  extends UseLikesOptions,
    HeadlessProps<LikesRootState>,
    Omit<React.ComponentPropsWithoutRef<"div">, "className" | "style" | "children"> {}

/** Provider + container for a post's likes. Renders a `<div>` by default. */
export const Root = React.forwardRef<HTMLDivElement, LikesRootProps>(function LikesRoot(props, ref) {
  const {
    post,
    pageSize,
    maxPages,
    initialData,
    data,
    onRefetch,
    appView,
    fetchImpl,
    cacheTtlMs,
    revalidateOnMount,
    render,
    className,
    style,
    children,
    ...rest
  } = props;

  const value = useLikes({
    post,
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(maxPages !== undefined ? { maxPages } : {}),
    ...(initialData !== undefined ? { initialData } : {}),
    // Presence, not value — see useLikes' own `controlled` check.
    ...("data" in props ? { data } : {}),
    ...(onRefetch !== undefined ? { onRefetch } : {}),
    ...(appView !== undefined ? { appView } : {}),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    ...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}),
    ...(revalidateOnMount !== undefined ? { revalidateOnMount } : {}),
  });

  const state: LikesRootState = { status: value.status, total: value.total, isEmpty: value.isEmpty };

  const element = renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      // Mirror Comments.Root: signal the fetch to assistive tech while pending.
      "aria-busy": value.isLoading || undefined,
      ...rest,
      ...dataAttrs({
        status: value.status,
        loading: value.isLoading,
        revalidating: value.isRevalidating,
        error: value.isError,
        empty: value.isEmpty,
        total: value.total,
      }),
      children,
    },
  });

  return <Provider value={value}>{element}</Provider>;
});

// ── Provider (context bridge for a hand-rolled tree, SLIMS-70) ─────────────────

export interface LikesProviderProps {
  /** The return of your OWN `useLikes()` call — lets you mount `Likes.*` leaf parts (`Count`, `Avatars`, …) without `Likes.Root` owning the fetch/state machine itself. */
  value: UseLikesReturn;
  children?: React.ReactNode;
}

/** The context half of `Likes.Root`, without the fetch/render half — same idea as `Comments.Provider`. */
export function Provider({ value, children }: LikesProviderProps): React.ReactElement {
  return <LikesRootContext.Provider value={value}>{children}</LikesRootContext.Provider>;
}

// ── Count ────────────────────────────────────────────────────────────────────

export interface LikesCountState {
  total: number;
}

export type LikesCountProps = PartProps<LikesCountState, "span">;

/** The collected like total. Defaults to the number. */
export const Count = React.forwardRef<HTMLSpanElement, LikesCountProps>(function LikesCount(
  { render, className, style, children, ...rest },
  ref,
) {
  const { total } = useLikesContext();
  const state: LikesCountState = { total };
  return renderElement("span", {
    state,
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ total }), children: children ?? total },
  });
});

// ── Button (like/unlike the post — SLIMS-69) ────────────────────────────────

export interface LikeButtonState {
  liked: boolean | undefined;
  count: number;
  isBusy: boolean;
  isDisabled: boolean;
}

export interface LikeButtonProps
  extends UseLikeButtonOptions,
    HeadlessProps<LikeButtonState>,
    Omit<React.ComponentPropsWithoutRef<"button">, "className" | "style" | "children" | "disabled" | "onClick"> {}

/**
 * Standalone like/unlike toggle for the post itself. No `Likes.Root` needed —
 * `liked`/`onLike`/`onUnlike` are injected props (this package never imports
 * `@hedgerow/reader` or any auth library, per docs/architecture.md), same
 * idiom as `Reply.Root`'s `session`/`onSubmit`. `count` is whatever
 * authoritative number you pass in (e.g. `Comments.Root`'s `stats.likeCount`)
 * — the button optimistically adjusts it by ±1 around your in-flight/
 * just-completed toggle, then defers back to your prop once it catches up.
 * Reflects `data-liked` / `data-busy` / `data-disabled`.
 */
export const Button = React.forwardRef<HTMLButtonElement, LikeButtonProps>(function LikesButton(
  { liked, count, onLike, onUnlike, disabled, render, className, style, children, ...rest },
  ref,
) {
  const value = useLikeButton({ liked, count, onLike, onUnlike, ...(disabled !== undefined ? { disabled } : {}) });
  const state: LikeButtonState = {
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
});

// ── Avatars ──────────────────────────────────────────────────────────────────

/** Wrap one liker's template in its context. */
function LikeProvider({ like, children }: { like: Like; children: React.ReactNode }): React.ReactElement {
  return <LikeItemContext.Provider value={like}>{children}</LikeItemContext.Provider>;
}

export interface LikesAvatarsState {
  count: number;
  total: number;
}

export interface LikesAvatarsProps extends PartProps<LikesAvatarsState, "div"> {
  /** Cap how many likers to render (e.g. an avatar stack of 5). */
  max?: number;
}

/**
 * Renders one entry per liker. With a child template (referencing `Likes.Avatar`)
 * it repeats that per liker; with no children it renders a default `<img>` stack.
 * Renders nothing when there are no likes.
 */
export const Avatars = React.forwardRef<HTMLDivElement, LikesAvatarsProps>(function LikesAvatars(
  { render, className, style, children, max, ...rest },
  ref,
) {
  const { likes, total } = useLikesContext();
  const shown = max !== undefined ? likes.slice(0, max) : likes;
  if (shown.length === 0) return null;

  const state: LikesAvatarsState = { count: shown.length, total };
  const items = shown.map((like) => (
    <LikeProvider key={keyOf(like)} like={like}>
      {children ?? <Avatar />}
    </LikeProvider>
  ));

  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ count: shown.length, total }), children: items },
  });
});

export interface LikeAvatarState {
  like: Like;
  actor: Like["actor"];
}

export type LikeAvatarProps = PartProps<LikeAvatarState, "img">;

/** A single liker's avatar `<img>`. Renders nothing when they have no avatar. */
export const Avatar = React.forwardRef<HTMLImageElement, LikeAvatarProps>(function LikeAvatar(
  { render, className, style, ...rest },
  ref,
) {
  const like = useLikeItemContext();
  if (!like.actor.avatar) return null;
  const state: LikeAvatarState = { like, actor: like.actor };
  return renderElement("img", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      src: like.actor.avatar,
      alt: like.actor.displayName || like.actor.handle,
      loading: "lazy",
      ...rest,
      ...dataAttrs({ handle: like.actor.handle }),
    },
  });
});

// ── Conditional status wrappers ──────────────────────────────────────────────

export type LikesLoadingProps = PartProps<Record<string, never>, "div">;

export const Loading = React.forwardRef<HTMLDivElement, LikesLoadingProps>(function LikesLoading(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isLoading } = useLikesContext();
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

export type LikesEmptyProps = PartProps<Record<string, never>, "div">;

export const Empty = React.forwardRef<HTMLDivElement, LikesEmptyProps>(function LikesEmpty(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isEmpty } = useLikesContext();
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

export interface LikesErrorState {
  error: unknown;
}

export type LikesErrorProps = PartProps<LikesErrorState, "div">;

export const ErrorMessage = React.forwardRef<HTMLDivElement, LikesErrorProps>(function LikesError(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isError, error } = useLikesContext();
  if (!isError) return null;
  const state: LikesErrorState = { error };
  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: { role: "alert", ...rest, ...dataAttrs({ error: true }), children },
  });
});
