// The headless engine behind `Likes.Button`/`Comments.LikeButton`. Same "state
// and the actual write are both injected" contract as `useReply` — this
// package stays auth-free (see docs/architecture.md), so `liked`/`onLike`/
// `onUnlike` are plain props a consumer wires up (e.g. from `@hedgerow/reader`'s
// `findLike`/`like`/`unlike`), not anything this hook fetches itself.
import { useCallback, useEffect, useState } from "react";

export interface UseLikeButtonOptions {
  /**
   * Whether the reader has already liked the subject. `undefined` while
   * unknown (e.g. a `findLike` lookup still resolving) — the toggle is
   * disabled until this settles, since there's nothing correct to toggle to.
   */
  liked: boolean | undefined;
  /** The current authoritative count (e.g. a post's `stats.likeCount`, or a comment's own `likeCount`) to optimistically adjust. */
  count: number;
  /** Like the subject. A rejection rolls the optimistic state back (see `toggle`). */
  onLike: () => void | Promise<void>;
  /** Unlike the subject. A rejection rolls the optimistic state back (see `toggle`). */
  onUnlike: () => void | Promise<void>;
  /** Disable the toggle (e.g. no reader session). Default false. */
  disabled?: boolean;
}

export interface UseLikeButtonReturn {
  /** `liked`, overlaid with any in-flight optimistic toggle. */
  liked: boolean | undefined;
  /** `count`, adjusted by any in-flight/just-completed optimistic toggle. */
  count: number;
  isBusy: boolean;
  isDisabled: boolean;
  /** Flip liked/unliked. No-ops while disabled, busy, or `liked` is still unknown. Never rejects — see `onLike`/`onUnlike`. */
  toggle: () => Promise<void>;
}

export function useLikeButton(options: UseLikeButtonOptions): UseLikeButtonReturn {
  const { liked, count, onLike, onUnlike, disabled = false } = options;

  // The optimistic overlay: the toggle we're claiming is true, and the count
  // delta it implies. Cleared once the caller's own `liked` prop catches up
  // (their state update after a successful onLike/onUnlike resolves) — see
  // the effect below — so it never lingers past the real state settling.
  const [pending, setPending] = useState<{ liked: boolean; delta: number } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (pending && pending.liked === liked) setPending(null);
  }, [liked, pending]);

  const toggle = useCallback(async () => {
    if (disabled || isBusy || liked === undefined) return;
    const next = !liked;
    setPending({ liked: next, delta: next ? 1 : -1 });
    setIsBusy(true);
    try {
      await (next ? onLike() : onUnlike());
    } catch {
      setPending(null);
      // Roll back — the write didn't happen. Not rethrown: `Likes.Button`/
      // `Comments.LikeButton` fire this from a plain onClick (no await), so a
      // throw here would surface as an unhandled rejection with nothing to
      // catch it. A consumer that wants to react to the failure does so
      // inside their own `onLike`/`onUnlike` (e.g. show a toast) — that's
      // also where the actual error detail already is.
    } finally {
      setIsBusy(false);
    }
  }, [disabled, isBusy, liked, onLike, onUnlike]);

  return {
    liked: pending ? pending.liked : liked,
    count: count + (pending ? pending.delta : 0),
    isBusy,
    isDisabled: disabled || liked === undefined,
    toggle,
  };
}
