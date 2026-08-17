import { browserSessionAgent, type BrowserSession } from "./browser.js";
import type { CreateReplyInput, StrongRef } from "./types.js";

const LIKE_COLLECTION = "app.bsky.feed.like";
const LIKE_PAGE_SIZE = 100;
const LIKE_MAX_PAGES = 10;

/** Signed-in social mutations. Authentication is supplied as a browser session. */
export interface SocialActor {
  readonly did: string;
  createReply(input: CreateReplyInput): Promise<StrongRef>;
  like(subject: StrongRef): Promise<StrongRef>;
  unlike(likeUri: string): Promise<void>;
  findLike(subjectUri: string): Promise<string | null>;
}

/** Bind a browser identity to replies and likes, without exposing repo writes. */
export function createSocialActor(session: BrowserSession): SocialActor {
  let likeBySubject = new Map<string, StrongRef | null>();
  const subjectByLikeUri = new Map<string, string>();
  const pendingLookups = new Map<string, Promise<StrongRef | null>>();

  async function searchOwnLikes(subjectUri: string): Promise<StrongRef | null> {
    const agent = browserSessionAgent(session);
    let cursor: string | undefined;
    for (let page = 0; page < LIKE_MAX_PAGES; page++) {
      const { records, cursor: next } = await agent.listOwnRecords({
        collection: LIKE_COLLECTION,
        limit: LIKE_PAGE_SIZE,
        reverse: true,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      for (const record of records) {
        const subject = (record.value as { subject?: { uri?: string } }).subject;
        if (subject?.uri === subjectUri) {
          return { uri: record.uri, cid: record.cid };
        }
      }
      if (!next || records.length === 0) return null;
      cursor = next;
    }
    return null;
  }

  function findLikeRef(subjectUri: string): Promise<StrongRef | null> {
    if (likeBySubject.has(subjectUri)) {
      // Validate that the session is still active even for a cache hit.
      browserSessionAgent(session);
      return Promise.resolve(likeBySubject.get(subjectUri)!);
    }
    const pending =
      pendingLookups.get(subjectUri) ??
      searchOwnLikes(subjectUri).finally(() => pendingLookups.delete(subjectUri));
    pendingLookups.set(subjectUri, pending);
    return pending.then((found) => {
      likeBySubject.set(subjectUri, found);
      if (found) subjectByLikeUri.set(found.uri, subjectUri);
      return found;
    });
  }

  return {
    did: session.did,
    async createReply({ root, parent, text }) {
      const agent = browserSessionAgent(session);
      const { uri, cid } = await agent.post({
        $type: "app.bsky.feed.post",
        text,
        reply: { root, parent },
        createdAt: new Date().toISOString(),
      });
      return { uri, cid };
    },
    async like(subject) {
      const existing = await findLikeRef(subject.uri);
      if (existing) return existing;
      const { uri, cid } = await browserSessionAgent(session).like(
        subject.uri,
        subject.cid,
      );
      const ref = { uri, cid };
      likeBySubject.set(subject.uri, ref);
      subjectByLikeUri.set(uri, subject.uri);
      return ref;
    },
    async unlike(likeUri) {
      await browserSessionAgent(session).deleteLike(likeUri);
      const subjectUri = subjectByLikeUri.get(likeUri);
      if (subjectUri) {
        likeBySubject.set(subjectUri, null);
        subjectByLikeUri.delete(likeUri);
      }
    },
    async findLike(subjectUri) {
      const ref = await findLikeRef(subjectUri);
      return ref?.uri ?? null;
    },
  };
}
