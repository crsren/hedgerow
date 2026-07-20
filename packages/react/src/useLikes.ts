// The likes counterpart to useComments: same state machine, same SSR-safe
// effect-fetch, same latest-wins guard, same controlled-data escape hatch.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLikes, type Like, type LikesResult } from "@hedgerow/comments";
import type { RequestStatus } from "./useComments";

export interface UseLikesOptions {
  /** at:// URI or bsky.app URL of the liked post. */
  post: string;
  /** Actors per page (getLikes max is 100). */
  pageSize?: number;
  /** Max pages to fetch before stopping. */
  maxPages?: number;
  /** SSR-seeded data; suppresses the mount fetch (see useComments). Ignored when `data` (controlled mode) is provided. */
  initialData?: LikesResult;
  /**
   * Controlled data mode — same contract as `useComments`' `data`: when this
   * key is present at all (even `undefined`, while your own query is still
   * pending), the hook never fetches on its own; `status`/`total`/`likes`
   * derive from this prop, and `refetch()` calls `onRefetch` instead.
   */
  data?: LikesResult;
  /** Called by `refetch()` in controlled mode — see `data`. Ignored otherwise. */
  onRefetch?: () => void;
  /** Override the AppView base URL. */
  appView?: string;
  /** Injectable fetch. */
  fetchImpl?: typeof fetch;
  /** Handle→DID resolution cache TTL. */
  cacheTtlMs?: number;
  /** With `initialData` seeded, fire one extra `refetch()` right after mount (uncontrolled mode only) — see `useComments`' option of the same name. Default false. */
  revalidateOnMount?: boolean;
}

export interface UseLikesReturn {
  status: RequestStatus;
  data: LikesResult | undefined;
  error: unknown;
  /** The actors who liked the post (capped by pageSize × maxPages). */
  likes: Like[];
  /** Number of likes actually collected. */
  total: number;
  /** Cursor for the next uncollected page, when likes remain. */
  cursor: string | undefined;
  refetch: () => void;
  isIdle: boolean;
  /** True only while the INITIAL fetch is in flight (no data yet) — background refetches report {@link isRevalidating}. Always `false` in controlled data mode. */
  isLoading: boolean;
  /** True while a refetch is in flight WITH previous data still showing. Always `false` in controlled data mode. */
  isRevalidating: boolean;
  isSuccess: boolean;
  isError: boolean;
  /** True once loaded with zero likes. */
  isEmpty: boolean;
}

interface State {
  status: RequestStatus;
  data: LikesResult | undefined;
  error: unknown;
}

export function useLikes(options: UseLikesOptions): UseLikesReturn {
  const { post, pageSize, maxPages, appView, cacheTtlMs, initialData, onRefetch, revalidateOnMount = false } =
    options;
  // Presence, not value — see useComments' identical `controlled` check for why.
  const controlled = "data" in options;
  const controlledData = options.data;

  const [state, setState] = useState<State>(() =>
    initialData
      ? { status: "success", data: initialData, error: undefined }
      : { status: "idle", data: undefined, error: undefined },
  );

  const requestId = useRef(0);
  const fetchImplRef = useRef(options.fetchImpl);
  fetchImplRef.current = options.fetchImpl;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((prev) => ({ status: "loading", data: prev.data, error: undefined }));
    try {
      const data = await fetchLikes(post, {
        ...(pageSize !== undefined ? { pageSize } : {}),
        ...(maxPages !== undefined ? { maxPages } : {}),
        ...(appView !== undefined ? { appView } : {}),
        ...(fetchImplRef.current !== undefined ? { fetchImpl: fetchImplRef.current } : {}),
        ...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}),
      });
      if (id === requestId.current) setState({ status: "success", data, error: undefined });
    } catch (error) {
      // Stale-while-error — see useComments' identical fix: a failed
      // REFETCH keeps whatever likes we already had showing.
      if (id === requestId.current) setState((prev) => ({ status: "error", data: prev.data, error }));
    }
  }, [post, pageSize, maxPages, appView, cacheTtlMs]);

  const refetchControlled = useCallback(() => {
    onRefetch?.();
  }, [onRefetch]);
  const doRefetch = controlled ? refetchControlled : load;

  // Idempotent mount-fetch guard — see useComments' identical `seededLoadRef`
  // for why this must never be flipped by the effect itself (Strict Mode's
  // double-invoke on mount reuses the same `load` identity both times).
  const seededLoadRef = useRef<typeof load | undefined>(initialData ? load : undefined);
  useEffect(() => {
    if (controlled) return;
    if (seededLoadRef.current === load) return;
    void load();
  }, [load, controlled]);

  // revalidateOnMount — see useComments' identical option/effect.
  const revalidatedRef = useRef(false);
  useEffect(() => {
    if (controlled || !revalidateOnMount || !initialData || revalidatedRef.current) return;
    revalidatedRef.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = controlled ? controlledData : state.data;
  const status: RequestStatus = controlled ? (data !== undefined ? "success" : "idle") : state.status;
  const isSuccess = status === "success";
  const likes = data?.likes ?? [];
  return {
    status,
    data,
    error: controlled ? undefined : state.error,
    likes,
    total: data?.total ?? 0,
    cursor: data?.cursor,
    refetch: doRefetch,
    isIdle: status === "idle",
    isLoading: !controlled && status === "loading" && state.data === undefined,
    isRevalidating: !controlled && status === "loading" && state.data !== undefined,
    isSuccess,
    isError: status === "error",
    isEmpty: isSuccess && likes.length === 0,
  };
}
