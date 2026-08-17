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
} from "./records.js";
import {
  BSKY_POST_NSID,
  DOCUMENT_NSID,
  type DocumentRecord,
  type StrongRef,
} from "./types.js";

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
