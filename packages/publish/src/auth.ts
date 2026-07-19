// Pluggable write auth. v0 is app-password; atproto OAuth will implement the same
// Publisher interface later, so callers (publishSite) never change.
import { AtpAgent } from "@atproto/api";
import { resolvePds } from "./read.js";

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

/** Wrap an already-authenticated AtpAgent as a Publisher (used by tests + OAuth later). */
export function agentPublisher(agent: AtpAgent): Publisher {
  const did = agent.session?.did;
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
      } catch {
        return null; // RecordNotFound (or transient error — worst case we re-put)
      }
    },
    async deleteRecord(collection, rkey) {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
    },
  };
}

export interface AppPasswordOptions {
  identifier: string;
  /** An app password (Bluesky → Settings → App Passwords), NEVER the account password. */
  password: string;
  /**
   * PDS endpoint override (mainly for tests/local PDS). When omitted, the
   * identifier's DID document is resolved and its #atproto_pds endpoint is
   * used — never a hardcoded bsky.social, so self-hosted PDS accounts work.
   */
  service?: string;
}

/** Log in with an app password and return a Publisher. */
export async function appPasswordPublisher(opts: AppPasswordOptions): Promise<Publisher> {
  const service = opts.service ?? (await resolvePds(opts.identifier)).pds;
  const agent = new AtpAgent({ service });
  await agent.login({ identifier: opts.identifier, password: opts.password });
  return agentPublisher(agent);
}
