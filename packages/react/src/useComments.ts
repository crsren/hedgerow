// The headless engine. `useComments` owns the whole state machine
// (idle → loading → success | error), fetches in an effect (never during
// render, so it's SSR-safe), and derives the sorted+filtered comment tree.
// Components are a thin shell over this; a consumer can use it directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchThread,
  sortReplies,
  type CommentNode,
  type PostStats,
  type SortOrder,
  type ThreadResult,
} from "@hedgerow/comments";

/** Where in the state machine a fetch currently sits. */
export type RequestStatus = "idle" | "loading" | "success" | "error";

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
  /** Top-level comments (root's replies), sorted and filtered. */
  comments: CommentNode[];
  /** Active reply order. */
  sort: SortOrder;
  /** Change the reply order (re-sorts client-side; no refetch). */
  setSort: (sort: SortOrder) => void;
  /** Re-run the fetch. */
  refetch: () => void;
  isIdle: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  /** True once loaded with zero visible top-level comments. */
  isEmpty: boolean;
}

interface State {
  status: RequestStatus;
  data: ThreadResult | undefined;
  error: unknown;
}

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

export function useComments(options: UseCommentsOptions): UseCommentsReturn {
  const { post, maxDepth, appView, cacheTtlMs, initialData, filter } = options;

  const [sort, setSort] = useState<SortOrder>(options.sort ?? "newest");
  const [state, setState] = useState<State>(() =>
    initialData
      ? { status: "success", data: initialData, error: undefined }
      : { status: "idle", data: undefined, error: undefined },
  );

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
      if (id === requestId.current) setState({ status: "success", data, error: undefined });
    } catch (error) {
      if (id === requestId.current) setState({ status: "error", data: undefined, error });
    }
  }, [post, maxDepth, appView, cacheTtlMs]);

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

  const root = state.data?.post;
  const comments = useMemo(() => {
    if (!root || root.type !== "comment") return [];
    const sorted = sortReplies(root.replies, sort);
    return filter ? filterTree(sorted, filter) : sorted;
  }, [root, sort, filter]);

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
  };
}
