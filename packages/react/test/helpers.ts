import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// Reuse the read core's captured AppView fixtures — the components run against
// exactly the shapes the core is tested with.
const FIXTURES = join(HERE, "../../comments/test/fixtures");

export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as T;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The XRPC method name from an AppView request URL (last path segment). */
export function methodOf(url: URL): string {
  return url.pathname.split("/").pop() ?? "";
}

/** A counting fetch stub that dispatches on the requested XRPC method. */
export function stubFetch(
  handler: (method: string, url: URL) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input.toString();
    calls.push(href);
    const url = new URL(href);
    return handler(methodOf(url), url);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

/** A promise plus its resolver — for controlling when a fetch settles. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export const ROOT_URI = "at://did:plc:6kos45lixtga3pdwuncvh32x/app.bsky.feed.post/3mqc36slinc2m";
