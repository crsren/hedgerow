export interface ArticleFields {
  title: string;
  markdown: string;
  path: string;
  description: string;
  tags: string[];
  publishedAt: string;
}

export interface LocalDraft extends ArticleFields {
  key: string;
  did: string;
  uri: string | null;
  baseCid: string | null;
  savedAt: string;
  revision: number;
}

export class LocalDraftConflictError extends Error {
  constructor(readonly key: string) {
    super(`A newer local copy of ${key} was saved in another tab.`);
    this.name = "LocalDraftConflictError";
  }
}

const DATABASE_NAME = "hedgerow-author-drafts";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const channel = typeof BroadcastChannel === "undefined"
  ? null
  : new BroadcastChannel("hedgerow-author-drafts");

let writeQueue: Promise<void> = Promise.resolve();

export const publishedDraftKey = (did: string, uri: string): string =>
  `${did}:published:${uri}`;

export const newDraftKey = (did: string): string =>
  `${did}:new:${crypto.randomUUID()}`;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("did", "did");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local draft storage."));
  });
}

async function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local draft storage failed."));
  });
}

async function readTransaction<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await requestValue(operation(database.transaction(STORE_NAME).objectStore(STORE_NAME)));
  } finally {
    database.close();
  }
}

export async function readDraft(key: string): Promise<LocalDraft | undefined> {
  await writeQueue;
  return readTransaction((store) => store.get(key));
}

export async function listDrafts(did: string): Promise<LocalDraft[]> {
  await writeQueue;
  return readTransaction((store) => store.index("did").getAll(did));
}

async function commitDraft(
  draft: Omit<LocalDraft, "revision">,
  expectedRevision: number | null,
): Promise<LocalDraft> {
  const database = await openDatabase();
  try {
    return await new Promise<LocalDraft>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const get = store.get(draft.key);
      let next: LocalDraft | undefined;

      get.onsuccess = () => {
        const current = get.result as LocalDraft | undefined;
        if ((current?.revision ?? null) !== expectedRevision) {
          transaction.abort();
          reject(new LocalDraftConflictError(draft.key));
          return;
        }
        next = { ...draft, revision: (current?.revision ?? 0) + 1 };
        store.put(next);
      };
      get.onerror = () => reject(get.error ?? new Error("Could not inspect the local draft."));
      transaction.oncomplete = () => next && resolve(next);
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the local draft."));
      transaction.onabort = () => {
        if (!next) return;
        reject(transaction.error ?? new Error("Local draft save was interrupted."));
      };
    });
  } finally {
    database.close();
  }
}

export async function writeDraft(
  draft: Omit<LocalDraft, "revision">,
  expectedRevision: number | null,
): Promise<LocalDraft> {
  let result!: LocalDraft;
  const write = writeQueue.then(async () => {
    result = await commitDraft(draft, expectedRevision);
    channel?.postMessage({ key: result.key, revision: result.revision });
  });
  writeQueue = write.catch(() => undefined);
  await write;
  return result;
}

export function removeDraft(key: string, expectedRevision: number): Promise<void> {
  const write = writeQueue.then(async () => {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const get = store.get(key);
        get.onsuccess = () => {
          const current = get.result as LocalDraft | undefined;
          if (!current) return;
          if (current.revision !== expectedRevision) {
            transaction.abort();
            reject(new LocalDraftConflictError(key));
            return;
          }
          store.delete(key);
        };
        get.onerror = () => reject(get.error ?? new Error("Could not inspect the local draft."));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not discard the local draft."));
      });
    } finally {
      database.close();
    }
    channel?.postMessage({ key, revision: null });
  });
  writeQueue = write.catch(() => undefined);
  return write;
}

/**
 * Reconcile local state after a successful PDS write. If nothing changed
 * locally during the network request, the published draft is removed. If a
 * newer tab revision exists, preserve it as unpublished work based on the new
 * remote CID (and move a brand-new draft under the published document key).
 */
export async function finishDraftPublish(
  key: string,
  did: string,
  publishedRevision: number,
  uri: string,
  cid: string,
): Promise<LocalDraft | null> {
  let result: LocalDraft | null = null;
  const write = writeQueue.then(async () => {
    const database = await openDatabase();
    const targetKey = publishedDraftKey(did, uri);
    try {
      result = await new Promise<LocalDraft | null>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const sourceRequest = store.get(key);
        const targetRequest = targetKey === key ? null : store.get(targetKey);
        let source: LocalDraft | undefined;
        let target: LocalDraft | undefined;
        let ready = 0;

        const reconcile = () => {
          ready += 1;
          if (ready !== (targetRequest ? 2 : 1)) return;
          if (!source) return;
          if (target && target.key !== source.key) {
            transaction.abort();
            reject(new LocalDraftConflictError(targetKey));
            return;
          }
          if (source.revision <= publishedRevision) {
            store.delete(source.key);
            result = null;
            return;
          }
          result = {
            ...source,
            key: targetKey,
            uri,
            baseCid: cid,
            savedAt: new Date().toISOString(),
            revision: targetKey === source.key ? source.revision + 1 : 1,
          };
          if (targetKey !== source.key) store.delete(source.key);
          store.put(result);
        };

        sourceRequest.onsuccess = () => {
          source = sourceRequest.result as LocalDraft | undefined;
          reconcile();
        };
        sourceRequest.onerror = () => reject(sourceRequest.error ?? new Error("Could not inspect the published draft."));
        if (targetRequest) {
          targetRequest.onsuccess = () => {
            target = targetRequest.result as LocalDraft | undefined;
            reconcile();
          };
          targetRequest.onerror = () => reject(targetRequest.error ?? new Error("Could not inspect the published draft target."));
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not finish the local publish."));
      });
    } finally {
      database.close();
    }
    channel?.postMessage({ key, revision: null });
    if (result) channel?.postMessage({ key: result.key, revision: result.revision });
  });
  writeQueue = write.catch(() => undefined);
  await write;
  return result;
}

export function watchDrafts(listener: (key: string) => void): () => void {
  if (!channel) return () => undefined;
  const handle = (event: MessageEvent<{ key?: unknown }>) => {
    if (typeof event.data?.key === "string") listener(event.data.key);
  };
  channel.addEventListener("message", handle);
  return () => channel.removeEventListener("message", handle);
}

export async function requestPersistentDraftStorage(): Promise<boolean | undefined> {
  return navigator.storage?.persist?.();
}
