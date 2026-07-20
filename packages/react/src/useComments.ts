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
 * `Comments.Item` as `data-state` (absent for an ordinarily-fetched node):
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
   * or an explicit `refetch()`).
   */
  initialData?: ThreadResult;
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
}

export interface UseCommentsReturn {
  /** Current state-machine node. */
  status: RequestStatus;
  /** The raw thread result once loaded. */
  data: ThreadResult | undefined;
  /** The error from the last failed fetch, if any. */
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
  /** Re-run the fetch. Also drives the optimistic-reply confirm/unconfirm sweep — see {@link DeliveryState}. */
  refetch: () => void;
  isIdle: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  /** True once loaded with zero visible top-level comments. */
  isEmpty: boolean;
  /**
   * Insert a reply into the tree immediately, keyed by its own (real) uri —
   * no temp-id reconciliation needed since the write already happened and
   * returned a real ref. Works for both top-level replies (`parentUri` = the
   * root post's uri) and nested ones (`parentUri` = an existing comment's
   * uri). See {@link DeliveryState} for the pending → confirmed/unconfirmed
   * lifecycle this then goes through as `refetch()` is called.
   */
  addOptimisticReply: (input: OptimisticReplyInput) => void;
  /** `Comments.Item`'s `data-state` source — undefined for an ordinary fetched node. */
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

/** How long a just-confirmed node keeps reporting `data-state="confirmed"` before the attribute disappears entirely. */
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
  const { post, maxDepth, appView, cacheTtlMs, initialData, filter, optimisticGiveUpAfter = 3 } = options;

  const [sort, setSort] = useState<SortOrder>(options.sort ?? "newest");
  const [state, setState] = useState<State>(() =>
    initialData
      ? { status: "success", data: initialData, error: undefined }
      : { status: "idle", data: undefined, error: undefined },
  );
  const [optimistic, setOptimistic] = useState<Map<string, OptimisticEntry>>(new Map());
  const [justConfirmed, setJustConfirmed] = useState<Set<string>>(new Set());
  const confirmedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => confirmedTimers.current.forEach(clearTimeout), []);

  // Latest-wins guard so a slow response can't clobber a newer one, and a stable
  // handle for the caller-supplied fetch so an inline `fetchImpl` doesn't churn
  // the load callback (and thus the effect).
  const requestId = useRef(0);
  const fetchImplRef = useRef(options.fetchImpl);
  fetchImplRef.current = options.fetchImpl;

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

      // Confirm/unconfirm sweep: run every optimistic entry against this
      // fetch's real tree. Confirmed entries are dropped (the real node now
      // renders in their place) after a brief `data-state="confirmed"` flash;
      // the rest either keep waiting or give up into "unconfirmed" — which,
      // per DeliveryState's contract, is a permanent, still-visible state,
      // not a removal.
      setOptimistic((prev) => {
        if (prev.size === 0) return prev;
        const realUris = new Set<string>();
        collectUris(data.post, realUris);
        const confirmedNow: string[] = [];
        const next = new Map(prev);
        for (const [uri, entry] of prev) {
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
        return next;
      });
    } catch (error) {
      if (id === requestId.current) setState({ status: "error", data: undefined, error });
    }
  }, [post, maxDepth, appView, cacheTtlMs, optimisticGiveUpAfter]);

  // Fetch in an effect (SSR renders nothing over the wire). The seed from
  // `initialData` counts as the initial mount's load, so we skip exactly once.
  const usedSeed = useRef(Boolean(initialData));
  useEffect(() => {
    if (usedSeed.current) {
      usedSeed.current = false;
      return;
    }
    void load();
  }, [load]);

  const addOptimisticReply = useCallback((input: OptimisticReplyInput) => {
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
  }, []);

  const deliveryStateOf = useCallback(
    (uri: string): DeliveryState | undefined => {
      if (justConfirmed.has(uri)) return "confirmed";
      return optimistic.get(uri)?.status;
    },
    [optimistic, justConfirmed],
  );

  const root = state.data?.post;
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

  const status = state.status;
  const isSuccess = status === "success";
  return {
    status,
    data: state.data,
    error: state.error,
    root,
    stats: state.data?.stats,
    postUrl: state.data?.postUrl,
    comments,
    sort,
    setSort,
    refetch: load,
    isIdle: status === "idle",
    isLoading: status === "loading",
    isSuccess,
    isError: status === "error",
    isEmpty: isSuccess && comments.length === 0,
    addOptimisticReply,
    deliveryStateOf,
  };
}
