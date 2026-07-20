// The likes counterpart to useComments: same state machine, same SSR-safe
// effect-fetch, same latest-wins guard. Pages likes off the AppView via the
// read core and hands back a flat actor list plus the collected total.
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
  /** SSR-seeded data; suppresses the mount fetch (see useComments). */
  initialData?: LikesResult;
  /** Override the AppView base URL. */
  appView?: string;
  /** Injectable fetch. */
  fetchImpl?: typeof fetch;
  /** Handle→DID resolution cache TTL. */
  cacheTtlMs?: number;
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
  /** True only while the INITIAL fetch is in flight (no data yet) — background refetches report {@link isRevalidating}. */
  isLoading: boolean;
  /** True while a refetch is in flight WITH previous data still showing. */
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
  const { post, pageSize, maxPages, appView, cacheTtlMs, initialData } = options;

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
      if (id === requestId.current) setState({ status: "error", data: undefined, error });
    }
  }, [post, pageSize, maxPages, appView, cacheTtlMs]);

  const usedSeed = useRef(Boolean(initialData));
  useEffect(() => {
    if (usedSeed.current) {
      usedSeed.current = false;
      return;
    }
    void load();
  }, [load]);

  const status = state.status;
  const isSuccess = status === "success";
  const likes = state.data?.likes ?? [];
  return {
    status,
    data: state.data,
    error: state.error,
    likes,
    total: state.data?.total ?? 0,
    cursor: state.data?.cursor,
    refetch: load,
    isIdle: status === "idle",
    isLoading: status === "loading" && state.data === undefined,
    isRevalidating: status === "loading" && state.data !== undefined,
    isSuccess,
    isError: status === "error",
    isEmpty: isSuccess && likes.length === 0,
  };
}
