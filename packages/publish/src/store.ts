// A tiny JSON-file-backed key/value store. atproto's OAuth client persists two
// kinds of data through a `SimpleStore` interface (get/set/del/clear): the
// short-lived authorization state (keyed by the OAuth `state` param) and the
// long-lived session (keyed by the account DID). Both are plain JSON — the
// DPoP keys are stored as JWKs, not live key objects — so a file per store is
// all we need. Structurally this matches `SimpleStore`, so it drops straight
// into `NodeOAuthClient` without importing the store package.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A synchronous JSON-file map. Loads once on construction, flushes on every
 * mutation. Single-process only (the CLI publish flow) — no file locking.
 * Assignable to atproto's `SimpleStore<string, V>` (its methods may be async;
 * ours are sync, which satisfies the `Awaitable` return types).
 */
export class FileStore<V> {
  private data: Record<string, V>;

  constructor(private readonly path: string) {
    this.data = FileStore.load<V>(path);
  }

  private static load<V>(path: string): Record<string, V> {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, V>;
    } catch {
      // A corrupt store is treated as empty — worst case the user re-logs in.
      return {};
    }
  }

  get(key: string): V | undefined {
    return this.data[key];
  }

  set(key: string, value: V): void {
    this.data[key] = value;
    this.flush();
  }

  del(key: string): void {
    delete this.data[key];
    this.flush();
  }

  clear(): void {
    this.data = {};
    this.flush();
  }

  /** Not part of SimpleStore — lets the OAuth flow find a cached session's DID. */
  keys(): string[] {
    return Object.keys(this.data);
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2) + "\n");
  }
}
