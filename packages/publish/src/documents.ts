import { TID } from "@atproto/common-web";
import {
  RecordConflictError,
  isInvalidSwap,
  type ConditionalPublisher,
  type PublisherRecord,
} from "./auth.js";
import {
  markdownDocumentRecord,
  type MarkdownDocumentInput,
} from "./document-records.js";
import {
  BSKY_POST_NSID,
  DOCUMENT_NSID,
  PUBLICATION_NSID,
  type DocumentRecord,
  type StrongRef,
} from "./types.js";

/**
 * Maximum OAuth permissions for Hedgerow authoring: publication/document
 * records plus creating and compensating discussion posts. The profile RPC
 * lets an editor identify the active account without broad Bluesky access.
 */
export const SITE_AUTHOR_SCOPE = [
  "atproto",
  "rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview",
  `repo:${PUBLICATION_NSID}`,
  `repo:${DOCUMENT_NSID}`,
  `repo:${BSKY_POST_NSID}?action=create&action=delete`,
].join(" ");

/** A published document plus the CID required for a safe subsequent update. */
export type DocumentSnapshot = PublisherRecord<DocumentRecord>;

export interface ParsedRecordUri {
  did: string;
  collection: string;
  rkey: string;
}

/** Parse an at:// record URI and reject repository or collection mismatches. */
export function parseRecordUri(uri: string): ParsedRecordUri {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(uri);
  if (!match) throw new Error(`malformed AT Protocol record URI: ${uri}`);
  return { did: match[1]!, collection: match[2]!, rkey: match[3]! };
}

function documentTarget(publisher: ConditionalPublisher, uri: string): ParsedRecordUri {
  const target = parseRecordUri(uri);
  if (target.did !== publisher.did) {
    throw new Error(`cannot write a record owned by ${target.did} as ${publisher.did}`);
  }
  if (target.collection !== DOCUMENT_NSID) {
    throw new Error(`expected a ${DOCUMENT_NSID} URI, received ${target.collection}`);
  }
  return target;
}

async function putWithExpectedCid(
  publisher: ConditionalPublisher,
  collection: string,
  rkey: string,
  value: Record<string, unknown>,
  expectedCid: string | null,
): Promise<{ uri: string; cid: string }> {
  try {
    return await publisher.putRecord(collection, rkey, value, {
      swapRecord: expectedCid,
    });
  } catch (error) {
    if (error instanceof RecordConflictError) throw error;
    if (isInvalidSwap(error)) {
      throw new RecordConflictError(
        `record changed before it could be written: at://${publisher.did}/${collection}/${rkey}`,
        expectedCid,
        { cause: error },
      );
    }
    throw error;
  }
}

async function deleteWithExpectedCid(
  publisher: ConditionalPublisher,
  collection: string,
  rkey: string,
  expectedCid: string,
): Promise<void> {
  try {
    await publisher.deleteRecord(collection, rkey, { swapRecord: expectedCid });
  } catch (error) {
    if (error instanceof RecordConflictError) throw error;
    if (isInvalidSwap(error)) {
      throw new RecordConflictError(
        `record changed before it could be deleted: at://${publisher.did}/${collection}/${rkey}`,
        expectedCid,
        { cause: error },
      );
    }
    throw error;
  }
}

export type CreateDocumentInput = MarkdownDocumentInput;

/** Create a Markdown document under a standards-compliant TID record key. */
export async function createDocument(
  publisher: ConditionalPublisher,
  input: CreateDocumentInput,
): Promise<DocumentSnapshot> {
  const rkey = TID.nextStr();
  const value = markdownDocumentRecord(input);
  const result = await putWithExpectedCid(
    publisher,
    DOCUMENT_NSID,
    rkey,
    value as unknown as Record<string, unknown>,
    null,
  );
  return { ...result, value };
}

export interface UpdateDocumentInput {
  uri: string;
  /** CID observed when the draft's published baseline was loaded. */
  cid: string;
  document: Omit<MarkdownDocumentInput, "updatedAt">;
}

/** Update the same AT record, failing if its CID changed since it was loaded. */
export async function updateDocument(
  publisher: ConditionalPublisher,
  input: UpdateDocumentInput,
): Promise<DocumentSnapshot> {
  const target = documentTarget(publisher, input.uri);
  const value = markdownDocumentRecord({
    ...input.document,
    updatedAt: new Date().toISOString(),
  });
  const result = await putWithExpectedCid(
    publisher,
    DOCUMENT_NSID,
    target.rkey,
    value as unknown as Record<string, unknown>,
    input.cid,
  );
  return { ...result, value };
}

export interface DeleteDocumentInput {
  uri: string;
  /** CID observed when the document was loaded. */
  cid: string;
}

/** Delete a document only if it is still the version the caller observed. */
export async function deleteDocument(
  publisher: ConditionalPublisher,
  input: DeleteDocumentInput,
): Promise<void> {
  const target = documentTarget(publisher, input.uri);
  await deleteWithExpectedCid(publisher, DOCUMENT_NSID, target.rkey, input.cid);
}

export interface StartDiscussionInput {
  document: DocumentSnapshot;
  canonicalUrl: string;
  /** Defaults to the document title followed by its canonical URL. */
  text?: string;
}

export interface StartDiscussionResult {
  document: DocumentSnapshot;
  post: StrongRef;
}

/**
 * Create a Bluesky discussion post and link it to a document. If the document
 * update loses a race, the newly-created post is deleted again.
 */
export async function startDiscussion(
  publisher: ConditionalPublisher,
  input: StartDiscussionInput,
): Promise<StartDiscussionResult> {
  const target = documentTarget(publisher, input.document.uri);
  const postRkey = TID.nextStr();
  const postValue = {
    $type: BSKY_POST_NSID,
    text: input.text ?? `${input.document.value.title}\n\n${input.canonicalUrl}`,
    createdAt: new Date().toISOString(),
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: input.canonicalUrl,
        title: input.document.value.title,
        description: input.document.value.description ?? "",
      },
    },
  };
  const created = await putWithExpectedCid(
    publisher,
    BSKY_POST_NSID,
    postRkey,
    postValue,
    null,
  );
  const post = { uri: created.uri, cid: created.cid };

  try {
    const value: DocumentRecord = {
      ...input.document.value,
      bskyPostRef: post,
      updatedAt: new Date().toISOString(),
    };
    const updated = await putWithExpectedCid(
      publisher,
      DOCUMENT_NSID,
      target.rkey,
      value as unknown as Record<string, unknown>,
      input.document.cid,
    );
    return { post, document: { ...updated, value } };
  } catch (cause) {
    try {
      await deleteWithExpectedCid(publisher, BSKY_POST_NSID, postRkey, post.cid);
    } catch (rollbackError) {
      throw new AggregateError(
        [cause, rollbackError],
        `could not link discussion to ${input.document.uri}; cleanup also failed for ${post.uri}`,
      );
    }
    throw cause;
  }
}

/** Configuration that pins an author capability to one owner and publication. */
export interface SiteAuthorOptions {
  ownerDid: string;
  publicationUri: string;
}

/** Document fields supplied by an editor; publication membership is injected. */
export type SiteAuthorDocumentInput = Omit<
  MarkdownDocumentInput,
  "site" | "updatedAt" | "bskyPostRef"
>;

export interface SiteAuthorUpdateInput {
  /** Published baseline, including the CID that guards against lost updates. */
  snapshot: DocumentSnapshot;
  document: SiteAuthorDocumentInput;
}

export interface SiteAuthorDiscussionInput {
  snapshot: DocumentSnapshot;
  canonicalUrl: string;
  text?: string;
}

/**
 * Publication-bound authoring. Unlike a raw Publisher, this capability cannot
 * select an arbitrary repository, collection, record key or publication.
 */
export interface SiteAuthor {
  readonly did: string;
  readonly publicationUri: string;
  createDocument(document: SiteAuthorDocumentInput): Promise<DocumentSnapshot>;
  updateDocument(input: SiteAuthorUpdateInput): Promise<DocumentSnapshot>;
  deleteDocument(snapshot: DocumentSnapshot): Promise<void>;
  startDiscussion(input: SiteAuthorDiscussionInput): Promise<StartDiscussionResult>;
}

function assertPublicationMember(
  publicationUri: string,
  snapshot: DocumentSnapshot,
): void {
  if (snapshot.value.site !== publicationUri) {
    throw new Error(
      `document ${snapshot.uri} belongs to ${snapshot.value.site ?? "no publication"}, not ${publicationUri}`,
    );
  }
}

/** Bind a conditional repository transport to one publication's safe operations. */
export function createSiteAuthor(
  publisher: ConditionalPublisher,
  options: SiteAuthorOptions,
): SiteAuthor {
  if (publisher.did !== options.ownerDid) {
    throw new Error(
      `author session belongs to ${publisher.did}, expected ${options.ownerDid}`,
    );
  }
  const publication = parseRecordUri(options.publicationUri);
  if (publication.did !== options.ownerDid) {
    throw new Error(
      `publication belongs to ${publication.did}, expected ${options.ownerDid}`,
    );
  }
  if (publication.collection !== PUBLICATION_NSID) {
    throw new Error(
      `expected a ${PUBLICATION_NSID} URI, received ${publication.collection}`,
    );
  }

  return {
    did: options.ownerDid,
    publicationUri: options.publicationUri,
    async createDocument(document) {
      return await createDocument(publisher, {
        ...document,
        site: options.publicationUri,
      });
    },
    async updateDocument(input) {
      assertPublicationMember(options.publicationUri, input.snapshot);
      return await updateDocument(publisher, {
        uri: input.snapshot.uri,
        cid: input.snapshot.cid,
        document: {
          ...input.document,
          site: options.publicationUri,
          ...(input.snapshot.value.bskyPostRef
            ? { bskyPostRef: input.snapshot.value.bskyPostRef }
            : {}),
        },
      });
    },
    async deleteDocument(snapshot) {
      assertPublicationMember(options.publicationUri, snapshot);
      await deleteDocument(publisher, {
        uri: snapshot.uri,
        cid: snapshot.cid,
      });
    },
    async startDiscussion(input) {
      assertPublicationMember(options.publicationUri, input.snapshot);
      return await startDiscussion(publisher, {
        document: input.snapshot,
        canonicalUrl: input.canonicalUrl,
        ...(input.text !== undefined ? { text: input.text } : {}),
      });
    },
  };
}
