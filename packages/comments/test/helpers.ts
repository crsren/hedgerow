import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Load a fixture JSON by basename (without extension) from test/fixtures. */
export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(HERE, "fixtures", `${name}.json`), "utf8")) as T;
}

/** Await a promise expecting rejection; return the thrown error typed as E. */
export async function catchError<E = unknown>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (e) {
    return e as E;
  }
  throw new Error("expected the promise to reject, but it resolved");
}

/** A fetch stub that records every call and dispatches on the requested URL. */
export interface StubbedFetch {
  fetch: typeof fetch;
  /** URLs requested, in order. */
  readonly calls: string[];
}

/** Build a JSON Response like the AppView would return. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a counting fetch stub. `handler` receives the parsed URL and returns a
 * Response (or throws to simulate a network failure). Every call is recorded.
 */
export function stubFetch(handler: (url: URL) => Response | Promise<Response>): StubbedFetch {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input.toString();
    calls.push(href);
    return handler(new URL(href));
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
