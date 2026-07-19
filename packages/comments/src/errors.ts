// A single typed error for every failed AppView call, so renderers can tell
// "post deleted" (an XRPC error like NotFound / InvalidRequest, status 4xx)
// apart from "network down" (the fetch itself threw — status 0, `network` true).

export class HedgerowFetchError extends Error {
  /** HTTP status, or 0 when the request never completed (network failure). */
  readonly status: number;
  /** True when fetch itself rejected (offline, DNS, CORS) — no HTTP response. */
  readonly network: boolean;
  /** The XRPC error name from the response body, e.g. "NotFound", when parseable. */
  readonly xrpcError?: string;
  /** The XRPC human-readable message from the response body, when present. */
  readonly xrpcMessage?: string;
  /** The XRPC method that failed, e.g. "app.bsky.feed.getPostThread". */
  readonly method?: string;
  /** The underlying error, when this wraps a thrown fetch rejection. */
  readonly cause?: unknown;

  constructor(
    message: string,
    opts: {
      status: number;
      network?: boolean;
      xrpcError?: string;
      xrpcMessage?: string;
      method?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "HedgerowFetchError";
    this.status = opts.status;
    this.network = opts.network ?? false;
    this.xrpcError = opts.xrpcError;
    this.xrpcMessage = opts.xrpcMessage;
    this.method = opts.method;
    this.cause = opts.cause;
  }

  /**
   * The post is gone: either the AppView returned an explicit NotFound XRPC
   * error, or a 404. (A live thread whose *root* is deleted comes back instead
   * as a `notFound` placeholder node, not an error — this is for the harder
   * failures where the whole call is rejected.)
   */
  get isNotFound(): boolean {
    return this.xrpcError === "NotFound" || this.status === 404;
  }
}
