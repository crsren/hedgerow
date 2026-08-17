// Pluggable write auth. Publishing authenticates via atproto OAuth (see
// oauth.ts); callers only ever see the Publisher interface, so publishSite
// never cares how you logged in.
import type { Agent } from "@atproto/api";

/** A record returned by the authenticated repository, including its CAS token. */
export interface PublisherRecord<T = Record<string, unknown>> {
  uri: string;
  cid: string;
  value: T;
}

/** Compare-and-swap options for a record write. `null` means the record must not exist. */
export interface PutRecordOptions {
  swapRecord?: string | null;
}

/** Compare-and-swap options for a record deletion. */
export interface DeleteRecordOptions {
  swapRecord?: string;
}

/** Minimal write surface publishSite needs — decouples it from how you authed. */
export interface Publisher {
  did: string;
  putRecord(
    collection: string,
    rkey: string,
    record: Record<string, unknown>,
    options?: PutRecordOptions,
  ): Promise<{ uri: string; cid: string }>;
  /** Existing record value, or null if absent — lets publishSite skip unchanged writes. */
  getRecord(collection: string, rkey: string): Promise<Record<string, unknown> | null>;
  /** Delete a record. Used by prune to remove orphaned documents. */
  deleteRecord(collection: string, rkey: string, options?: DeleteRecordOptions): Promise<void>;
}

/**
 * Publisher with record-CID reads and conditional writes. New authoring APIs
 * require this surface so a stale browser tab cannot silently overwrite a
 * newer record. The legacy {@link Publisher} remains supported by publishSite.
 */
export interface ConditionalPublisher extends Publisher {
  readonly supportsSwapRecord: true;
  getRecordWithCid(
    collection: string,
    rkey: string,
  ): Promise<PublisherRecord | null>;
}

/** A conditional write lost its race with another client or tab. */
export class RecordConflictError extends Error {
  readonly expectedCid: string | null;

  constructor(message: string, expectedCid: string | null, options?: ErrorOptions) {
    super(message, options);
    this.name = "RecordConflictError";
    this.expectedCid = expectedCid;
  }
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

/** True only for AT Protocol's compare-and-swap mismatch error. */
export function isInvalidSwap(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { error?: unknown; name?: unknown };
  return e.error === "InvalidSwap" || e.name === "InvalidSwapError";
}

/** Narrow a legacy Publisher to the conditional surface. */
export function supportsConditionalWrites(
  publisher: Publisher,
): publisher is ConditionalPublisher {
  return (
    (publisher as Partial<ConditionalPublisher>).supportsSwapRecord === true &&
    typeof (publisher as Partial<ConditionalPublisher>).getRecordWithCid === "function"
  );
}

/**
 * Wrap an already-authenticated {@link Agent} as a Publisher. Works for any
 * `Agent` subclass: the `AtpAgent` used in tests and the OAuth-session-backed
 * `Agent` that `oauthPublisher` builds both expose `.did` and the
 * `com.atproto.repo.*` methods, so a single adapter covers both.
 */
export function agentPublisher(agent: Agent): ConditionalPublisher {
  const did = agent.did;
  if (!did) throw new Error("agentPublisher: agent has no active session (not logged in)");
  return {
    did,
    supportsSwapRecord: true,
    async putRecord(collection, rkey, record, options) {
      try {
        const res = await agent.com.atproto.repo.putRecord({
          repo: did,
          collection,
          rkey,
          record,
          ...(options && "swapRecord" in options
            ? { swapRecord: options.swapRecord }
            : {}),
        });
        return { uri: res.data.uri, cid: res.data.cid };
      } catch (err) {
        if (isInvalidSwap(err)) {
          throw new RecordConflictError(
            `record changed before it could be written: at://${did}/${collection}/${rkey}`,
            options?.swapRecord ?? null,
            { cause: err },
          );
        }
        throw err;
      }
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
    async getRecordWithCid(collection, rkey) {
      try {
        const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });
        if (!res.data.cid) {
          throw new Error(`getRecord returned no cid: at://${did}/${collection}/${rkey}`);
        }
        return {
          uri: res.data.uri,
          cid: res.data.cid,
          value: res.data.value as Record<string, unknown>,
        };
      } catch (err) {
        if (isRecordNotFound(err)) return null;
        throw err;
      }
    },
    async deleteRecord(collection, rkey, options) {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection,
          rkey,
          ...(options?.swapRecord ? { swapRecord: options.swapRecord } : {}),
        });
      } catch (err) {
        if (isInvalidSwap(err)) {
          throw new RecordConflictError(
            `record changed before it could be deleted: at://${did}/${collection}/${rkey}`,
            options?.swapRecord ?? null,
            { cause: err },
          );
        }
        throw err;
      }
    },
  };
}
