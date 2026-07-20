// Pluggable write auth. Publishing authenticates via atproto OAuth (see
// oauth.ts); callers only ever see the Publisher interface, so publishSite
// never cares how you logged in.
import type { Agent } from "@atproto/api";

/** Minimal write surface publishSite needs — decouples it from how you authed. */
export interface Publisher {
  did: string;
  putRecord(
    collection: string,
    rkey: string,
    record: Record<string, unknown>,
  ): Promise<{ uri: string; cid: string }>;
  /** Existing record value, or null if absent — lets publishSite skip unchanged writes. */
  getRecord(collection: string, rkey: string): Promise<Record<string, unknown> | null>;
  /** Delete a record. Used by prune to remove orphaned documents. */
  deleteRecord(collection: string, rkey: string): Promise<void>;
}

/**
 * True only for the PDS's "this record does not exist" error — the one case
 * `getRecord` may report as `null`. XRPC not-found surfaces as an error whose
 * `error` field is `"RecordNotFound"` (message: "Could not locate record: …").
 */
export function isRecordNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { error?: unknown; message?: unknown };
  return (
    e.error === "RecordNotFound" ||
    (typeof e.message === "string" && e.message.includes("Could not locate record"))
  );
}

/**
 * Wrap an already-authenticated {@link Agent} as a Publisher. Works for any
 * `Agent` subclass: the `AtpAgent` used in tests and the OAuth-session-backed
 * `Agent` that `oauthPublisher` builds both expose `.did` and the
 * `com.atproto.repo.*` methods, so a single adapter covers both.
 */
export function agentPublisher(agent: Agent): Publisher {
  const did = agent.did;
  if (!did) throw new Error("agentPublisher: agent has no active session (not logged in)");
  return {
    did,
    async putRecord(collection, rkey, record) {
      const res = await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey, record });
      return { uri: res.data.uri, cid: res.data.cid };
    },
    async getRecord(collection, rkey) {
      try {
        const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });
        return res.data.value as Record<string, unknown>;
      } catch (err) {
        // Only "record doesn't exist" may become null. A transient failure
        // must propagate: publishSite's anchor-fallback reads the existing
        // record to preserve its bskyPostRef, and a swallowed network error
        // here would read as "no existing record" and strip the anchor.
        if (isRecordNotFound(err)) return null;
        throw err;
      }
    },
    async deleteRecord(collection, rkey) {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
    },
  };
}
