// The headless engine. `useComments` owns the whole state machine
// (idle → loading → success | error), fetches in an effect (never during
// render, so it's SSR-safe), and derives the sorted+filtered comment tree.
// Components are a thin shell over this; a consumer can use it directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  atUriToBskyUrl,
  fetchThread,
  sortReplies,
  type Actor,
  type Comment,
  type CommentNode,
  type PostStats,
  type SortOrder,
  type ThreadResult,
} from "@hedgerow/comments";

/** Where in the state machine a fetch currently sits. */
export type RequestStatus = "idle" | "loading" | "success" | "error";

/**
 * Where an optimistically-inserted reply currently sits, surfaced on
 * `Comments.Item` as `data-delivery` (absent for an ordinarily-fetched node):
 *   - "pending": the write succeeded; not yet seen in a thread fetch.
 *   - "confirmed": a refetch just found this uri in the real tree — shown for
 *     one brief window (see `CONFIRMED_FLASH_MS`) as a hand-off signal, then
 *     the attribute disappears entirely (the node is now just a normal one).
 *   - "unconfirmed": {@link UseCommentsOptions.optimisticGiveUpAfter} refetches
 *     passed without the AppView indexing it. The node is kept showing
 *     regardless — never vanish a reply the write actually succeeded for.
 */
export type DeliveryState = "pending" | "confirmed" | "unconfirmed";

/** Input to {@link UseCommentsReturn.addOptimisticReply}. */
export interface OptimisticReplyInput {
  /** The new reply's own strongRef, as returned by the write (e.g. `@hedgerow/reader`'s `createReply()`). */
  ref: { uri: string; cid: string };
  /** uri of the comment (or the root post) this reply is nested under. */
  parentUri: string;
  text: string;
  author: Actor;
  /** Defaults to now. */
  createdAt?: string;
}

/** Default delay schedule for {@link UseCommentsOptions.confirmRetryDelays}. */
const DEFAULT_CONFIRM_RETRY_DELAYS = [2000, 4000, 6000];

export interface UseCommentsOptions {
  /** at:// URI or bsky.app URL of the post whose replies are the comments. */
  post: string;
  /** Initial reply order. Uncontrolled — change it later via the returned `setSort`. */
  sort?: SortOrder;
  /** Max reply depth to fetch and keep. Forwarded to fetchThread. */
  maxDepth?: number;
  /**
   * Keep a node when this returns true. Applied to the whole tree (nested
   * replies too). Moderation labels are surfaced but NEVER auto-hidden — hiding
   * labelled content is entirely this filter's job.
   */
  filter?: (node: CommentNode) => boolean;
  /**
   * SSR-seeded data. When provided, the hook starts in `success` with this data
   * and does NOT fetch on mount (it still refetches on `post`/`maxDepth` change
   * or an explicit `refetch()`). Ignored when `data` (controlled mode) is
   * provided — see below.
   */
  initialData?: ThreadResult;
  /**
   * Controlled data mode (e.g. driving this hook from your own TanStack Query
   * `useQuery`): when this key is present at all (even as `undefined`, while
   * your own query is still pending), the hook's internal fetch is disabled
   * entirely — it never calls `fetchThread` itself. `status`/`data`/`error`
   * derive from this prop instead (`"success"` once it's non-`undefined`,
   * `"idle"` while it's `undefined`), `refetch()` calls `onRefetch` instead of
   * fetching, and the whole derive layer — sort, `filter`, the optimistic
   * graft, and the confirm/unconfirm sweep — still runs, re-evaluated every
   * time this reference changes. See the README's "Controlled data" recipe.
   */
  data?: ThreadResult;
  /** Called by `refetch()` (and the optimistic confirm-retry schedule) when in controlled mode — see `data`. Ignored otherwise. */
  onRefetch?: () => void;
  /** Override the AppView base URL. */
  appView?: string;
  /** Injectable fetch — for tests, proxies, or custom runtimes. */
  fetchImpl?: typeof fetch;
  /** Handle→DID resolution cache TTL, forwarded to the resolver. */
  cacheTtlMs?: number;
  /**
   * How many successful `refetch()`s an optimistic reply survives without
   * being found in the fetched tree before it flips from "pending" to
   * "unconfirmed" (it is never removed either way — see {@link DeliveryState}).
   * Default 3.
   */
  optimisticGiveUpAfter?: number;
  /**
   * With `initialData` seeded, fire one extra `refetch()` right after mount
   * (uncontrolled mode only). Default false. Use this when your seed can go
   * stale between when it was captured (e.g. a statically-generated page,
   * built once) and when a given visitor loads it — the seed still renders
   * instantly with zero loading flash; this just closes the "reload right
   * after someone else changed the thread still shows the old snapshot" gap.
   */
  revalidateOnMount?: boolean;
  /**
   * Delay schedule (ms) for the optimistic confirm-retry loop `addOptimisticReply`
   * arms: each delay fires a `refetch()` — or `onRefetch()` in controlled mode —
   * but ONLY if that specific reply is still `"pending"` by then (a no-op once
   * it's been confirmed or given up on). Default `[2000, 4000, 6000]`. All
   * still-pending timers are cleared on unmount.
   */
  confirmRetryDelays?: number[];
}

export interface UseCommentsReturn {
  /** Current state-machine node. */
  status: RequestStatus;
  /** The raw thread result once loaded. */
  data: ThreadResult | undefined;
  /** The error from the last failed fetch, if any. `undefined` in controlled data mode — the consumer owns their own fetch's error state. */
  error: unknown;
  /** The root post node (the Bluesky share) — may itself be a stub. */
  root: CommentNode | undefined;
  /** Root-post engagement counts. */
  stats: PostStats | undefined;
  /** bsky.app URL of the root post — the "reply on Bluesky" target. */
  postUrl: string | undefined;
  /** Top-level comments (root's replies), sorted, filtered, and merged with any pending optimistic replies. */
  comments: CommentNode[];
  /** Active reply order. */
  sort: SortOrder;
  /** Change the reply order (re-sorts client-side; no refetch). */
  setSort: (sort: SortOrder) => void;
  /**
   * Re-run the fetch (uncontrolled mode) or call `onRefetch` (controlled
   * mode). Also drives the optimistic-reply confirm/unconfirm sweep in
   * uncontrolled mode — see {@link DeliveryState}. In controlled mode the
   * sweep instead runs whenever the `data` prop itself changes.
   */
  refetch: () => void;
  isIdle: boolean;
  /**
   * True only while the INITIAL fetch is in flight (no thread data yet).
   * Background refetches — the optimistic confirm sweep, a revalidate after
   * an SSR snapshot — keep showing the existing data and report
   * {@link isRevalidating} instead, so `Comments.Loading` never flashes in
   * (and shifts layout) over an already-rendered thread. Always `false` in
   * controlled data mode (there's no fetch of ours in flight to report on —
   * drive your own loading UI off your query's own status).
   */
  isLoading: boolean;
  /** True while a refetch is in flight WITH previous data still showing. Always `false` in controlled data mode — see `isLoading`. */
  isRevalidating: boolean;
  isSuccess: boolean;
  isError: boolean;
  /** True once loaded with zero visible top-level comments. */
  isEmpty: boolean;
  /**
   * Insert a reply into the tree immediately, keyed by its own (real) uri —
   * no temp-id reconciliation needed since the write already happened and
   * returned a real ref. Works for both top-level replies (`parentUri` = the
   * root post's uri) and nested ones (`parentUri` = an existing comment's
   * uri). Also arms the `confirmRetryDelays` schedule for this reply. See
   * {@link DeliveryState} for the pending → confirmed/unconfirmed lifecycle
   * this then goes through as `refetch()` is called.
   */
  addOptimisticReply: (input: OptimisticReplyInput) => void;
  /** `Comments.Item`'s `data-delivery` source — undefined for an ordinary fetched node. */
  deliveryStateOf: (uri: string) => DeliveryState | undefined;
}

interface State {
  status: RequestStatus;
  data: ThreadResult | undefined;
  error: unknown;
}

interface OptimisticEntry {
  node: Comment;
  parentUri: string;
  status: "pending" | "unconfirmed";
  fetchesSinceAdd: number;
}

/** How long a just-confirmed node keeps reporting `data-delivery="confirmed"` before the attribute disappears entirely. */
const CONFIRMED_FLASH_MS = 1200;

/** Recursively keep nodes the predicate accepts, preserving the tree shape. */
function filterTree(nodes: CommentNode[], predicate: (n: CommentNode) => boolean): CommentNode[] {
  const out: CommentNode[] = [];
  for (const node of nodes) {
    if (!predicate(node)) continue;
    if (node.type === "comment") out.push({ ...node, replies: filterTree(node.replies, predicate) });
    else out.push(node);
  }
  return out;
}

/** Every uri present anywhere in a (real, fetched) node tree — used to detect when an optimistic reply has landed. */
function collectUris(node: CommentNode | undefined, into: Set<string>): void {
  if (!node) return;
  into.add(node.uri);
  if (node.type === "comment") for (const reply of node.replies) collectUris(reply, into);
}

/**
 * Graft optimistic replies onto a real (unsorted) tree before sorting, so
 * `sortReplies` places each one exactly where its `createdAt` puts it under
 * the active order — no special-cased insertion position needed. Entries
 * whose uri is already present in `realUris` are skipped (the real fetched
 * node has landed and takes over; the confirm sweep will drop the entry from
 * state on the next render).
 */
function graftOptimistic(
  nodes: CommentNode[],
  parentUri: string,
  entries: OptimisticEntry[],
  realUris: Set<string>,
): CommentNode[] {
  const grafted = nodes.map((n) =>
    n.type === "comment" ? { ...n, replies: graftOptimistic(n.replies, n.uri, entries, realUris) } : n,
  );
  const direct = entries
    .filter((e) => e.parentUri === parentUri && !realUris.has(e.node.uri))
    .map((e) => e.node);
  return direct.length > 0 ? [...grafted, ...direct] : grafted;
}

export function useComments(options: UseCommentsOptions): UseCommentsReturn {
  const {
    post,
    maxDepth,
    appView,
    cacheTtlMs,
    initialData,
    filter,
    optimisticGiveUpAfter = 3,
    onRefetch,
    revalidateOnMount = false,
    confirmRetryDelays = DEFAULT_CONFIRM_RETRY_DELAYS,
  } = options;
  // Presence, not value: `data: undefined` (e.g. a TanStack Query still
  // pending) still means "controlled" — only OMITTING the key at all falls
  // back to this hook's own fetch. Checking the value instead (`data !==
  // undefined`) would flip a still-loading controlled consumer into
  // uncontrolled mode and fire an unwanted internal fetch.
  const controlled = "data" in options;
  const controlledData = options.data;

  const [sort, setSort] = useState<SortOrder>(options.sort ?? "newest");
  const [state, setState] = useState<State>(() =>
    initialData
      ? { status: "success", data: initialData, error: undefined }
      : { status: "idle", data: undefined, error: undefined },
  );
  const [optimistic, setOptimistic] = useState<Map<string, OptimisticEntry>>(new Map());
  const [justConfirmed, setJustConfirmed] = useState<Set<string>>(new Set());
  // Mirrors `optimistic` synchronously (assigned during render, not in an
  // effect) so async callbacks — a resolved fetch, a confirm-retry timer —
  // can read the CURRENT map without depending on (and thus re-creating
  // themselves whenever) `optimistic` itself, and without falling back to a
  // setState UPDATER for anything beyond the plain, final commit (see the
  // updater-purity note on sweepOptimisticOnNewData below).
  const optimisticRef = useRef(optimistic);
  optimisticRef.current = optimistic;

  const confirmedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const retryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      confirmedTimers.current.forEach(clearTimeout);
      retryTimers.current.forEach(clearTimeout);
    },
    [],
  );

  // Latest-wins guard so a slow response can't clobber a newer one, and a stable
  // handle for the caller-supplied fetch so an inline `fetchImpl` doesn't churn
  // the load callback (and thus the effect).
  const requestId = useRef(0);
  const fetchImplRef = useRef(options.fetchImpl);
  fetchImplRef.current = options.fetchImpl;

  /**
   * Confirm/unconfirm sweep: run every optimistic entry against a freshly-
   * arrived real tree (from either an uncontrolled fetch or a new controlled
   * `data` prop). Confirmed entries are dropped (the real node now renders in
   * their place) after a brief `data-delivery="confirmed"` flash; the rest
   * either keep waiting or give up into "unconfirmed" — a permanent, still-
   * visible state, not a removal.
   *
   * A PURE computation followed by plain, ordinary `setState` statements —
   * deliberately NOT a `setOptimistic(prev => ...)` updater with side effects
   * (`setJustConfirmed` calls, `setTimeout` scheduling) nested inside it.
   * React may invoke an updater function more than once for the same commit
   * (Strict Mode's double-invoke, or a bailout-and-replay), and doing so
   * would double-fire those side effects. Reading the current map off
   * `optimisticRef` (rather than a `prev` updater argument) is what makes
   * hoisting the computation out safe.
   */
  const sweepOptimisticOnNewData = useCallback(
    (data: ThreadResult) => {
      const prevOptimistic = optimisticRef.current;
      if (prevOptimistic.size === 0) return;

      const realUris = new Set<string>();
      collectUris(data.post, realUris);
      const confirmedNow: string[] = [];
      const next = new Map(prevOptimistic);
      for (const [uri, entry] of prevOptimistic) {
        if (realUris.has(uri)) {
          next.delete(uri);
          confirmedNow.push(uri);
          continue;
        }
        const fetchesSinceAdd = entry.fetchesSinceAdd + 1;
        const status: OptimisticEntry["status"] =
          fetchesSinceAdd >= optimisticGiveUpAfter ? "unconfirmed" : "pending";
        next.set(uri, { ...entry, status, fetchesSinceAdd });
      }

      setOptimistic(next);
      if (confirmedNow.length > 0) {
        setJustConfirmed((prevConfirmed) => new Set([...prevConfirmed, ...confirmedNow]));
        confirmedTimers.current.push(
          setTimeout(() => {
            setJustConfirmed((prevConfirmed) => {
              const nextConfirmed = new Set(prevConfirmed);
              for (const uri of confirmedNow) nextConfirmed.delete(uri);
              return nextConfirmed;
            });
          }, CONFIRMED_FLASH_MS),
        );
      }
    },
    [optimisticGiveUpAfter],
  );

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((prev) => ({ status: "loading", data: prev.data, error: undefined }));
    try {
      const data = await fetchThread(post, {
        ...(maxDepth !== undefined ? { maxDepth } : {}),
        ...(appView !== undefined ? { appView } : {}),
        ...(fetchImplRef.current !== undefined ? { fetchImpl: fetchImplRef.current } : {}),
        ...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}),
      });
      if (id !== requestId.current) return;
      setState({ status: "success", data, error: undefined });
      sweepOptimisticOnNewData(data);
    } catch (error) {
      // Stale-while-error: keep whatever data we already had showing (don't
      // null it out just because a REFETCH failed) — the thread stays
      // rendered, `isError` flips true, and the two coexist. Only a fetch
      // that never had prior data ends up with `data: undefined` here too,
      // which is just the ordinary "failed before ever loading" case.
      if (id === requestId.current) setState((prev) => ({ status: "error", data: prev.data, error }));
    }
  }, [post, maxDepth, appView, cacheTtlMs, sweepOptimisticOnNewData]);

  const refetchControlled = useCallback(() => {
    onRefetch?.();
  }, [onRefetch]);

  /** What `refetch()` (and the confirm-retry schedule) actually calls — the internal fetch, or the consumer's own in controlled mode. */
  const doRefetch = controlled ? refetchControlled : load;

  // Fetch in an effect (SSR renders nothing over the wire), skipped
  // entirely in controlled mode. `seededLoadRef` captures the very first
  // render's `load` — an IDEMPOTENT guard (never mutated by the effect
  // itself) rather than the old "flip a ref once" approach: React 18 Strict
  // Mode double-invokes an effect on mount (run → cleanup → run again) using
  // the SAME `load` identity both times (nothing changed in between), so
  // comparing against a ref that's never written skips BOTH invocations
  // consistently. A ref that gets flipped to false by the first invocation
  // would leave the second invocation seeing "already used" and fetch
  // anyway — the exact bug this replaces. Once `post`/`maxDepth`/etc. genuinely
  // change, `load`'s identity changes too, so it stops matching
  // `seededLoadRef.current` (fixed at the initial value) and every
  // subsequent run fetches, same as an ordinary prop-driven refetch.
  const seededLoadRef = useRef<typeof load | undefined>(initialData ? load : undefined);
  useEffect(() => {
    if (controlled) return;
    if (seededLoadRef.current === load) return;
    void load();
  }, [load, controlled]);

  // revalidateOnMount: one EXTRA refetch right after mount when seeded via
  // initialData (uncontrolled only) — replaces the demo's own
  // RevalidateOnMount workaround component. `revalidatedRef` makes this
  // idempotent under Strict Mode's double-invoke the same way `seededLoadRef`
  // does above: it's set unconditionally on the very first invocation, so a
  // second invocation (same commit) sees it already true and no-ops — never
  // reset, so it can't fire twice no matter how many times the effect is
  // invoked for this one mount.
  const revalidatedRef = useRef(false);
  useEffect(() => {
    if (controlled || !revalidateOnMount || !initialData || revalidatedRef.current) return;
    revalidatedRef.current = true;
    void load();
    // Deliberately once, right after mount — not on every `load` identity
    // change (post/maxDepth churn already re-triggers the effect above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controlled mode: re-run the confirm/unconfirm sweep every time the
  // `data` prop itself changes (a new reference from the consumer's own
  // query/cache) — the one piece of the derive layer that's otherwise only
  // triggered by OUR OWN fetch resolving.
  const prevControlledDataRef = useRef<ThreadResult | undefined>(undefined);
  useEffect(() => {
    if (!controlled || controlledData === undefined) return;
    if (prevControlledDataRef.current === controlledData) return;
    prevControlledDataRef.current = controlledData;
    sweepOptimisticOnNewData(controlledData);
  }, [controlled, controlledData, sweepOptimisticOnNewData]);

  const addOptimisticReply = useCallback(
    (input: OptimisticReplyInput) => {
      const node: Comment = {
        type: "comment",
        uri: input.ref.uri,
        cid: input.ref.cid,
        author: input.author,
        text: input.text,
        createdAt: input.createdAt ?? new Date().toISOString(),
        likeCount: 0,
        replyCount: 0,
        repostCount: 0,
        labels: [],
        replies: [],
        url: atUriToBskyUrl(input.ref.uri),
      };
      setOptimistic((prev) => {
        const next = new Map(prev);
        next.set(input.ref.uri, { node, parentUri: input.parentUri, status: "pending", fetchesSinceAdd: 0 });
        return next;
      });

      // Arm the confirm-retry schedule: each delay refetches ONLY if this
      // specific reply is still "pending" by then — a no-op once the ordinary
      // confirm/unconfirm sweep (driven by any refetch, from any source) has
      // already settled it. Reading optimisticRef (not `optimistic` itself)
      // keeps this closure valid without re-arming on every state change.
      const uri = input.ref.uri;
      for (const delayMs of confirmRetryDelays) {
        const timer = setTimeout(() => {
          if (optimisticRef.current.get(uri)?.status === "pending") doRefetch();
        }, delayMs);
        retryTimers.current.push(timer);
      }
    },
    [confirmRetryDelays, doRefetch],
  );

  const deliveryStateOf = useCallback(
    (uri: string): DeliveryState | undefined => {
      if (justConfirmed.has(uri)) return "confirmed";
      return optimistic.get(uri)?.status;
    },
    [optimistic, justConfirmed],
  );

  const data = controlled ? controlledData : state.data;
  const root = data?.post;
  const comments = useMemo(() => {
    if (!root || root.type !== "comment") return [];
    let replies = root.replies;
    if (optimistic.size > 0) {
      const realUris = new Set<string>();
      collectUris(root, realUris);
      replies = graftOptimistic(replies, root.uri, [...optimistic.values()], realUris);
    }
    const sorted = sortReplies(replies, sort);
    return filter ? filterTree(sorted, filter) : sorted;
  }, [root, sort, filter, optimistic]);

  const status: RequestStatus = controlled ? (data !== undefined ? "success" : "idle") : state.status;
  const isSuccess = status === "success";
  return {
    status,
    data,
    error: controlled ? undefined : state.error,
    root,
    stats: data?.stats,
    postUrl: data?.postUrl,
    comments,
    sort,
    setSort,
    refetch: doRefetch,
    isIdle: status === "idle",
    isLoading: !controlled && status === "loading" && state.data === undefined,
    isRevalidating: !controlled && status === "loading" && state.data !== undefined,
    isSuccess,
    isError: status === "error",
    isEmpty: isSuccess && comments.length === 0,
    addOptimisticReply,
    deliveryStateOf,
  };
}
