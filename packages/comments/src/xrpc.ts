// Hand-rolled XRPC GET against a public AppView. No @atproto/api — this package
// ships to browsers and stays dependency-slim. `fetchImpl` is injectable so the
// whole read path is testable against fixtures with a counting stub.
import { HedgerowFetchError } from "./errors.js";

/** The public, unauthenticated Bluesky AppView. */
export const DEFAULT_APPVIEW = "https://public.api.bsky.app";

/** The atproto collection every Bluesky post lives in. */
export const POST_COLLECTION = "app.bsky.feed.post";

/** Query params for an XRPC GET; array values expand to repeated keys. */
export type XrpcParams = Record<string, string | number | boolean | undefined>;

/**
 * GET an XRPC method and parse the JSON body. Throws {@link HedgerowFetchError}
 * on any non-2xx (carrying the parsed XRPC `error`/`message`) and on a network
 * failure (status 0, `network: true`).
 */
export async function xrpcGet<T>(
  baseUrl: string,
  method: string,
  params: XrpcParams,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const u = new URL(`${baseUrl.replace(/\/+$/, "")}/xrpc/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetchImpl(u.toString());
  } catch (cause) {
    throw new HedgerowFetchError(`${method}: network request failed`, {
      status: 0,
      network: true,
      method,
      cause,
    });
  }

  if (!res.ok) {
    // XRPC errors are JSON `{ error, message }`; tolerate a non-JSON body.
    let xrpcError: string | undefined;
    let xrpcMessage: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      xrpcError = body.error;
      xrpcMessage = body.message;
    } catch {
      /* body wasn't JSON — leave the XRPC fields undefined */
    }
    throw new HedgerowFetchError(
      `${method}: ${res.status}${xrpcError ? ` ${xrpcError}` : ""}${
        xrpcMessage ? ` — ${xrpcMessage}` : ""
      }`,
      { status: res.status, method, xrpcError, xrpcMessage },
    );
  }

  return (await res.json()) as T;
}
