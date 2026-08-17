import { useCallback, useEffect, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import {
  RecordConflictError,
  author,
  documentMarkdown,
  readSite,
  type DocumentSnapshot,
} from "hedgerow/site";
import type { BrowserSession } from "hedgerow/browser";
import { authorAuth } from "../hedgerow/browser";
import { hedgerowConfig, publicationUri } from "../hedgerow/config";
import {
  LocalDraftConflictError,
  finishDraftPublish,
  listDrafts,
  newDraftKey,
  publishedDraftKey,
  readDraft,
  removeDraft,
  requestPersistentDraftStorage,
  watchDrafts,
  writeDraft,
  type ArticleFields,
  type LocalDraft,
} from "../hedgerow/drafts";
import {
  exportMarkdown,
  importMarkdown,
  markdownFilename,
  slugify,
  unsupportedMarkdown,
} from "../hedgerow/markdown-files";
import ArticleDiff from "./ArticleDiff";
import TiptapMarkdown from "./TiptapMarkdown";
import "./author-editor.css";

type View = "edit" | "preview" | "changes";
type LocalStatus = "idle" | "saving" | "saved" | "error" | "conflict";

const renderer = new MarkdownIt({ html: false, linkify: true, typographer: true });

function emptyArticle(): ArticleFields {
  const now = new Date().toISOString();
  return {
    title: "",
    markdown: "",
    path: "/blog/untitled",
    description: "",
    tags: [],
    publishedAt: now,
  };
}

function fieldsFromDocument(document: DocumentSnapshot): ArticleFields {
  const markdown = documentMarkdown(document.value);
  if (markdown === null) throw new Error(`Document ${document.uri} has no editable Markdown content.`);
  return {
    title: document.value.title,
    markdown,
    path: document.value.path ?? `/blog/${document.uri.split("/").at(-1)}`,
    description: document.value.description ?? "",
    tags: document.value.tags ?? [],
    publishedAt: document.value.publishedAt,
  };
}

function sameArticle(left: ArticleFields, right: ArticleFields): boolean {
  return left.title === right.title
    && left.markdown === right.markdown
    && left.path === right.path
    && left.description === right.description
    && left.publishedAt === right.publishedAt
    && left.tags.length === right.tags.length
    && left.tags.every((tag, index) => tag === right.tags[index]);
}

function asDocumentSnapshot(document: {
  uri: string | null;
  cid: string | null;
  value: DocumentSnapshot["value"];
}): DocumentSnapshot | null {
  return document.uri && document.cid
    ? { uri: document.uri, cid: document.cid, value: document.value }
    : null;
}

function downloadMarkdown(fields: ArticleFields): void {
  const url = URL.createObjectURL(new Blob([exportMarkdown(fields)], {
    type: "text/markdown;charset=utf-8",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = markdownFilename(fields);
  link.click();
  URL.revokeObjectURL(url);
}

export default function AuthorEditor() {
  const [session, setSession] = useState<BrowserSession | null | undefined>(undefined);
  const [handle, setHandle] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSnapshot[]>([]);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [current, setCurrent] = useState<LocalDraft | null>(null);
  const [baseline, setBaseline] = useState<ArticleFields | null>(null);
  const [view, setView] = useState<View>("edit");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [localStatus, setLocalStatus] = useState<LocalStatus>("idle");
  const [editGeneration, setEditGeneration] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentRef = useRef<LocalDraft | null>(null);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());

  currentRef.current = current;

  const dirty = Boolean(current && (!baseline || !sameArticle(current, baseline)));
  const selectedDocument = current?.uri
    ? documents.find((document) => document.uri === current.uri) ?? null
    : null;

  const refresh = useCallback(async () => {
    if (!publicationUri) return;
    setLoading(true);
    setError(null);
    try {
      const [site, stored] = await Promise.all([
        readSite(hedgerowConfig.authorDid, fetch, { publicationUri }),
        listDrafts(hedgerowConfig.authorDid),
      ]);
      const supported: DocumentSnapshot[] = [];
      for (const document of site.documents) {
        const snapshot = asDocumentSnapshot(document);
        if (!snapshot) continue;
        try {
          if (documentMarkdown(snapshot.value) !== null) supported.push(snapshot);
        } catch {
          // An editor must not coerce an unknown open-union content type.
        }
      }
      setDocuments(supported);
      setDrafts(stored);
      setSelectedKey((key) => key ?? stored.find((draft) => !draft.uri)?.key ?? supported[0]?.uri ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the publication.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void authorAuth.restore()
      .then((restored) => {
        setSession(restored);
        if (restored?.did !== hedgerowConfig.authorDid) {
          setAuthError(`Signed in as ${restored?.did}; this editor belongs to ${hedgerowConfig.authorDid}.`);
          return;
        }
        void requestPersistentDraftStorage();
        void refresh();
      })
      .catch((cause) => {
        setAuthError(cause instanceof Error ? cause.message : "Could not restore the author session.");
        setSession(null);
      });
  }, [refresh]);

  useEffect(() => watchDrafts((key) => {
    if (key === currentRef.current?.key) {
      setLocalStatus("conflict");
      setError("This draft changed in another tab. Reload it before continuing.");
    }
  }), []);

  const persistCurrent = useCallback(async (): Promise<LocalDraft | null> => {
    persistQueue.current = persistQueue.current.catch(() => undefined).then(async () => {
      const latest = currentRef.current;
      if (!latest || localStatus === "conflict") return;
      setLocalStatus("saving");
      try {
        const { revision, ...draft } = latest;
        const saved = await writeDraft({
          ...draft,
          savedAt: new Date().toISOString(),
        }, revision || null);
        currentRef.current = { ...latest, revision: saved.revision, savedAt: saved.savedAt };
        setCurrent((value) => value?.key === saved.key
          ? { ...value, revision: saved.revision, savedAt: saved.savedAt }
          : value);
        setDrafts((values) => [...values.filter((draft) => draft.key !== saved.key), saved]);
        setLocalStatus("saved");
      } catch (cause) {
        if (cause instanceof LocalDraftConflictError) setLocalStatus("conflict");
        else setLocalStatus("error");
        throw cause;
      }
    });
    await persistQueue.current;
    return currentRef.current;
  }, [localStatus]);

  useEffect(() => {
    if (!editGeneration || !current || !dirty || localStatus === "conflict") return;
    const timer = window.setTimeout(() => {
      void persistCurrent().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not save the local draft.");
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [editGeneration]);

  useEffect(() => {
    if (!selectedKey) {
      setCurrent(null);
      setBaseline(null);
      return;
    }
    let cancelled = false;
    const local = drafts.find((draft) => draft.key === selectedKey);
    if (local) {
      setCurrent(local);
      const published = local.uri ? documents.find((document) => document.uri === local.uri) : null;
      setBaseline(published ? fieldsFromDocument(published) : null);
      setLocalStatus("saved");
      setEditGeneration(0);
      setView("edit");
      return;
    }
    const published = documents.find((document) => document.uri === selectedKey);
    if (!published) return;
    const key = publishedDraftKey(hedgerowConfig.authorDid, published.uri);
    void readDraft(key).then((stored) => {
      if (cancelled) return;
      const fields = fieldsFromDocument(published);
      setBaseline(fields);
      setCurrent(stored ?? {
        ...fields,
        key,
        did: hedgerowConfig.authorDid,
        uri: published.uri,
        baseCid: published.cid,
        savedAt: new Date().toISOString(),
        revision: 0,
      });
      setLocalStatus(stored ? "saved" : "idle");
      setEditGeneration(0);
      setView("edit");
    });
    return () => { cancelled = true; };
  }, [documents, selectedKey]);

  async function choose(key: string): Promise<void> {
    if (key === selectedKey) return;
    if (dirty) await persistCurrent();
    setSelectedKey(key);
    setMessage(null);
    setError(null);
  }

  async function createDraft(): Promise<void> {
    if (dirty) await persistCurrent();
    const fields = emptyArticle();
    const saved = await writeDraft({
      ...fields,
      key: newDraftKey(hedgerowConfig.authorDid),
      did: hedgerowConfig.authorDid,
      uri: null,
      baseCid: null,
      savedAt: new Date().toISOString(),
    }, null);
    setDrafts((values) => [...values, saved]);
    setSelectedKey(saved.key);
  }

  function update(patch: Partial<ArticleFields>): void {
    setCurrent((value) => value ? { ...value, ...patch } : value);
    setEditGeneration((value) => value + 1);
    setMessage(null);
  }

  async function discard(): Promise<void> {
    if (!current) return;
    if (!window.confirm(current.uri ? "Discard all local changes to this article?" : "Discard this local draft?")) return;
    try {
      if (current.revision) await removeDraft(current.key, current.revision);
      setDrafts((values) => values.filter((draft) => draft.key !== current.key));
      if (current.uri && baseline) {
        setCurrent({ ...current, ...baseline, revision: 0, savedAt: new Date().toISOString() });
        setLocalStatus("idle");
        setEditGeneration(0);
      } else {
        setSelectedKey(documents[0]?.uri ?? null);
      }
      setMessage("Local changes discarded.");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not discard the draft.");
    }
  }

  async function publish(): Promise<void> {
    if (!session || !current || !publicationUri || session.did !== hedgerowConfig.authorDid) return;
    const path = current.path.startsWith("/") ? current.path : `/${current.path}`;
    if (!current.title.trim() || !current.markdown.trim()) {
      setError("Add a title and article body before publishing.");
      return;
    }
    if (!path.startsWith("/blog/") || /\s/.test(path)) {
      setError("Article paths must look like /blog/my-article and contain no spaces.");
      return;
    }
    if (Number.isNaN(Date.parse(current.publishedAt))) {
      setError("Choose a valid publication date.");
      return;
    }

    setPublishing(true);
    setError(null);
    setMessage(null);
    try {
      await persistCurrent();
      const latest = currentRef.current!;
      const writer = author(session, { ownerDid: hedgerowConfig.authorDid, publicationUri });
      const document = {
        title: latest.title.trim(),
        markdown: latest.markdown,
        path,
        publishedAt: new Date(latest.publishedAt).toISOString(),
        ...(latest.description.trim() ? { description: latest.description.trim() } : {}),
        ...(latest.tags.length ? { tags: latest.tags } : {}),
      };
      const snapshot = selectedDocument
        ? await writer.updateDocument({ snapshot: selectedDocument, document })
        : await writer.createDocument(document);

      let publishNote = selectedDocument ? "Article updated." : "Article published.";
      let cleanupError: string | null = null;
      try {
        const retained = await finishDraftPublish(
          latest.key,
          hedgerowConfig.authorDid,
          latest.revision,
          snapshot.uri,
          snapshot.cid,
        );
        if (retained) {
          publishNote += " Newer local changes from another tab were kept as unpublished changes.";
        }
      } catch (cause) {
        cleanupError = cause instanceof Error
          ? `Published, but local cleanup needs attention: ${cause.message}`
          : "Published, but local cleanup needs attention.";
      }
      await fetch("/api/hedgerow/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: snapshot.uri, cid: snapshot.cid }),
      }).catch(() => undefined);
      await refresh();
      setSelectedKey(snapshot.uri);
      setMessage(publishNote);
      if (cleanupError) setError(cleanupError);
    } catch (cause) {
      setError(cause instanceof RecordConflictError
        ? "The published article changed elsewhere. Reload before choosing which version to keep."
        : cause instanceof Error ? cause.message : "Could not publish the article.");
    } finally {
      setPublishing(false);
    }
  }

  async function startDiscussion(): Promise<void> {
    if (!session || !selectedDocument || !publicationUri) return;
    if (!window.confirm("Create a public Bluesky post for this article and use it as the comment thread?")) return;
    setPublishing(true);
    setError(null);
    try {
      const writer = author(session, { ownerDid: hedgerowConfig.authorDid, publicationUri });
      const result = await writer.startDiscussion({
        snapshot: selectedDocument,
        canonicalUrl: new URL(selectedDocument.value.path ?? "", `${hedgerowConfig.siteUrl}/`).toString(),
      });
      setDocuments((values) => values.map((document) => document.uri === result.document.uri ? result.document : document));
      setMessage("Bluesky discussion started.");
      await fetch("/api/hedgerow/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: result.document.uri, cid: result.document.cid }),
      }).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the discussion.");
    } finally {
      setPublishing(false);
    }
  }

  async function importFile(file: File): Promise<void> {
    try {
      const fields = importMarkdown(await file.text(), file.name);
      const warnings = unsupportedMarkdown(fields.markdown);
      if (warnings.length && !window.confirm(
        `This file contains ${warnings.join(", ")}, which TipTap may normalize or omit. Import it anyway?`,
      )) return;
      update(fields);
    } catch {
      setError("Could not read that Markdown file.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (!publicationUri) return <p>Run <code>pnpm hedgerow:bootstrap</code> before opening the editor.</p>;
  if (session === undefined) return <p>Restoring author session…</p>;
  if (!session) {
    return (
      <form className="hedgerow-login" onSubmit={(event) => {
        event.preventDefault();
        setAuthError(null);
        void authorAuth.signIn(handle, { state: "/sudo" }).catch((cause) => {
          setAuthError(cause instanceof Error ? cause.message : "Could not start sign in.");
        });
      }}>
        <h1>Author sign in</h1>
        <p>This requests access only to publication/document records and optional Bluesky discussion posts.</p>
        <p>Unpublished drafts stay unencrypted in this browser and are not sent to AT Protocol.</p>
        <label>Handle <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="you.bsky.social" required /></label>
        <button type="submit">Continue</button>
        {authError && <p role="alert">{authError}</p>}
      </form>
    );
  }
  if (session.did !== hedgerowConfig.authorDid) {
    return (
      <section className="hedgerow-login">
        <p role="alert">{authError}</p>
        <button type="button" onClick={() => void authorAuth.signOut().then(() => setSession(null))}>Log out</button>
      </section>
    );
  }

  const localOnly = drafts.filter((draft) => !draft.uri);
  const draftKeys = new Set(drafts.map((draft) => draft.key));
  const currentFields = current ? {
    title: current.title,
    markdown: current.markdown,
    path: current.path,
    description: current.description,
    tags: current.tags,
    publishedAt: current.publishedAt,
  } : null;

  return (
    <div className="hedgerow-author-shell">
      <aside>
        <div className="hedgerow-author-brand">
          <strong>{hedgerowConfig.siteName}</strong><span>/sudo</span>
        </div>
        <button className="hedgerow-primary" type="button" onClick={() => void createDraft()} disabled={publishing}>New article</button>
        {localOnly.length > 0 && <nav aria-label="Draft articles">
          <h2>Drafts</h2>
          {localOnly.map((draft) => <button type="button" className={selectedKey === draft.key ? "selected" : ""}
            onClick={() => void choose(draft.key)} key={draft.key}>{draft.title || "Untitled"}<small>local</small></button>)}
        </nav>}
        <nav aria-label="Published articles">
          <h2>Published</h2>
          {documents.map((document) => {
            const key = publishedDraftKey(hedgerowConfig.authorDid, document.uri);
            return <button type="button" className={selectedKey === document.uri ? "selected" : ""}
              onClick={() => void choose(document.uri)} key={document.uri}>
              {document.value.title}{draftKeys.has(key) && <small>draft</small>}
            </button>;
          })}
        </nav>
        <button className="hedgerow-logout" type="button" onClick={() => void authorAuth.signOut().then(() => setSession(null))}>Log out</button>
      </aside>

      <section className="hedgerow-author-outlet">
        <div className="hedgerow-author-actions" aria-live="polite">
          {current && dirty ? <>
            <span>{localStatus === "saving" ? "Saving locally…" : localStatus === "conflict" ? "Local conflict" : "Saved locally · unpublished changes"}</span>
            <button className="hedgerow-secondary" type="button" onClick={() => void discard()} disabled={publishing}>Discard changes</button>
            <button className="hedgerow-primary" type="button" onClick={() => void publish()} disabled={publishing || localStatus === "conflict"}>
              {publishing ? "Publishing…" : selectedDocument ? "Update" : "Publish"}
            </button>
          </> : <span className="hedgerow-action-placeholder" />}
        </div>

        {error && <p className="hedgerow-alert" role="alert">{error}</p>}
        {message && <p className="hedgerow-message" role="status">{message}</p>}
        {loading && !current && <p>Loading publication…</p>}

        {current && currentFields && <>
          <div className="hedgerow-view-tabs" role="tablist" aria-label="Article view">
            {(["edit", "preview", "changes"] as View[]).map((value) => (
              <button type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)} key={value}>
                {value[0]!.toUpperCase() + value.slice(1)}
              </button>
            ))}
            <button type="button" onClick={() => fileInput.current?.click()}>Import</button>
            <input ref={fileInput} hidden type="file" accept=".md,.markdown,text/markdown,text/plain"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
            <button type="button" onClick={() => downloadMarkdown(currentFields)}>Export</button>
          </div>

          {view === "edit" && <div className="hedgerow-edit-form">
            <input className="hedgerow-title" aria-label="Title" placeholder="Untitled article" value={current.title}
              onChange={(event) => {
                const title = event.target.value;
                update({
                  title,
                  ...(current.path === "/blog/untitled" ? { path: `/blog/${slugify(title) || "untitled"}` } : {}),
                });
              }} disabled={publishing} />
            <TiptapMarkdown value={current.markdown} onChange={(markdown) => update({ markdown })} disabled={publishing} />
            <details>
              <summary>Details</summary>
              <div className="hedgerow-details">
                <label>Path <input value={current.path} onChange={(event) => update({ path: event.target.value })} /></label>
                <label>Published <input type="date" value={current.publishedAt.slice(0, 10)}
                  onChange={(event) => {
                    if (event.target.value) update({ publishedAt: new Date(`${event.target.value}T12:00:00.000Z`).toISOString() });
                  }} /></label>
                <label>Description <textarea value={current.description} onChange={(event) => update({ description: event.target.value })} /></label>
                <label>Tags <input value={current.tags.join(", ")} onChange={(event) => update({ tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} /></label>
              </div>
            </details>
          </div>}

          {view === "preview" && <article className="hedgerow-preview">
            <h1>{current.title || "Untitled"}</h1>
            <div dangerouslySetInnerHTML={{ __html: renderer.render(current.markdown) }} />
          </article>}

          {view === "changes" && <ArticleDiff published={baseline ?? emptyArticle()} draft={currentFields} />}

          {selectedDocument && !selectedDocument.value.bskyPostRef && <div className="hedgerow-discussion">
            <p>Comments need one canonical Bluesky post.</p>
            <button className="hedgerow-secondary" type="button" onClick={() => void startDiscussion()} disabled={publishing || dirty}>Start discussion</button>
          </div>}
        </>}
      </section>
    </div>
  );
}
