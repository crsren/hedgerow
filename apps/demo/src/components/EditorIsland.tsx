// The /edit author authoring island (SLIMS-64, v0-in-demo): sign in with the
// SAME browser-OAuth reader identity + login UI pattern CommentThread.tsx
// uses for readers (see ../lib/reader.ts — the shared module both islands
// build on), then list the publication's documents (read via
// @hedgerow/publish's browser-safe isomorphic core — no session needed for
// reads) and edit one with @hedgerow/react's Editor.* parts, Tiptap mounted
// into Editor.Body's headless slot. Saving builds the updated
// site.standard.document record and writes it via reader.asPublisher() —
// the same Publisher contract @hedgerow/publish's publishSite writes
// through, just reached from the reader's own OAuth session instead of the
// CLI's oauthPublisher().
import { useCallback, useEffect, useState } from "react";
import { Editor, type EditorFields } from "@hedgerow/react";
import {
  DOCUMENT_NSID,
  MARKDOWN_CONTENT_NSID,
  readSite,
  toPlainText,
  type DocumentRecord,
} from "@hedgerow/publish";
import type { ReaderSession } from "@hedgerow/reader";
import { handleResolverOverride, plcDirectoryUrlOverride, reader } from "../lib/reader";
import TiptapMarkdownEditor from "./TiptapMarkdownEditor";
// Reuses the reply box's login-form/error/sign-out classes (see comment-thread.css)
// for the SAME login UI pattern on /edit, per the SLIMS-64 design; edit.css adds
// only the layout/parts that are specific to the editor itself.
import "./comment-thread.css";
import "./edit.css";

interface LoadedDoc {
  /** at:// uri — the rkey to write back to is derived from this. */
  uri: string;
  value: DocumentRecord;
}

/** Same one-line transform as apps/demo/src/lib/site.ts's slugOf — duplicated
 * here rather than imported, since site.ts pulls in node:fs (server-only)
 * and this component ships to the browser. */
function slugOf(doc: DocumentRecord): string {
  return (doc.path ?? "/").replace(/^\/+/, "");
}

export default function EditorIsland() {
  // undefined = still resuming a session; null = signed out; object = signed in.
  const [session, setSession] = useState<ReaderSession | null | undefined>(undefined);
  const [handleInput, setHandleInput] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [docs, setDocs] = useState<LoadedDoc[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  // The fields Editor.Root edits, snapshotted ONLY when the SELECTION changes
  // (see the effect below, keyed on selectedUri alone) — deliberately NOT
  // recomputed from `docs` on every render. `docs` is refreshed after a save
  // (so the sidebar list shows the new title); if `documentFields` were
  // derived fresh from `docs` each render instead, that refresh would hand
  // Editor.Root a NEW object reference for the post the author is still
  // editing, which useEditor reads as "a different document was selected"
  // and resets to a clean state — clobbering the "saved" status right after
  // a successful save. Keeping this its own state, updated only on
  // selectedUri changes, keeps the `document` prop reference stable across a
  // save so Editor.Root's own dirty/saved tracking is the source of truth.
  const [documentFields, setDocumentFields] = useState<EditorFields | null>(null);

  useEffect(() => {
    let cancelled = false;
    reader
      .restore()
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDocs = useCallback(async (did: string) => {
    setDocsError(null);
    try {
      // The signed-in author's own did IS the publication owner in this demo,
      // so no separate "which site" lookup is needed. `pds` is set only for
      // the local dev-net override (see ../lib/reader.ts); in production it's
      // omitted and readSite() resolves the real PDS via PLC, same as
      // apps/demo/src/lib/site.ts's server-side live mode.
      const site = await readSite(did, fetch, {
        ...(handleResolverOverride ? { pds: handleResolverOverride, service: handleResolverOverride } : {}),
        ...(plcDirectoryUrlOverride ? { plcUrl: plcDirectoryUrlOverride } : {}),
      });
      const loaded = site.documents.filter((d): d is LoadedDoc => d.uri !== null);
      setDocs(loaded);
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : "Could not load your documents.");
    }
  }, []);

  useEffect(() => {
    if (session) void loadDocs(session.did);
  }, [session, loadDocs]);

  // Snapshot the selected post's fields ONLY when the selection itself
  // changes — see documentFields's declaration above for why this must not
  // also depend on `docs`.
  useEffect(() => {
    if (!selectedUri) {
      setDocumentFields(null);
      return;
    }
    const doc = docs?.find((d) => d.uri === selectedUri);
    if (!doc) return;
    setDocumentFields({
      title: doc.value.title,
      markdown: doc.value.content?.markdown ?? doc.value.textContent ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUri]);

  async function handleSignIn() {
    const handle = handleInput.trim();
    if (!handle || signingIn) return;
    setSigningIn(true);
    setAuthError(null);
    try {
      await reader.signIn(handle); // redirects; only returns on failure/abort
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not start login.");
      setSigningIn(false);
    }
  }

  const selected = docs?.find((d) => d.uri === selectedUri) ?? null;

  async function handleSave(fields: { title: string; markdown: string }) {
    if (!selected) throw new Error("No document selected.");
    const rkey = selected.uri.split("/").pop();
    if (!rkey) throw new Error(`Malformed record uri: ${selected.uri}`);

    const updated: DocumentRecord = {
      ...selected.value,
      title: fields.title,
      content: { $type: MARKDOWN_CONTENT_NSID, markdown: fields.markdown },
      textContent: toPlainText(fields.markdown),
      updatedAt: new Date().toISOString(),
    };

    await reader.asPublisher().putRecord(DOCUMENT_NSID, rkey, updated as unknown as Record<string, unknown>);

    // Reflect the save locally so re-selecting the same post (or the list
    // view) shows the fresh title/content without a full reload.
    setDocs((prev) => prev?.map((d) => (d.uri === selected.uri ? { ...d, value: updated } : d)) ?? prev);
  }

  if (session === undefined) {
    return <p className="hedgerow-edit-status">Loading…</p>;
  }

  if (session === null) {
    return (
      <div className="hedgerow-edit-login">
        <p>Sign in as the site's author to edit a post.</p>
        <div className="hedgerow-reply-login">
          <input
            type="text"
            aria-label="Your Bluesky handle"
            className="hedgerow-reply-handle"
            placeholder="your-handle.bsky.social"
            value={handleInput}
            onChange={(event) => setHandleInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSignIn();
              }
            }}
            disabled={signingIn}
          />
          <button
            type="button"
            className="hedgerow-reply-login-button"
            onClick={handleSignIn}
            disabled={signingIn || !handleInput.trim()}
          >
            {signingIn ? "Redirecting…" : "Log in with Bluesky"}
          </button>
        </div>
        {authError && (
          <p className="hedgerow-reply-error" role="alert">
            {authError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="hedgerow-edit">
      <div className="hedgerow-edit-identity">
        <span>
          Editing as <strong>{session.displayName || session.handle}</strong>
        </span>
        <button
          type="button"
          className="hedgerow-reply-signout"
          onClick={() => {
            void reader.signOut().then(() => {
              setSession(null);
              setDocs(null);
              setSelectedUri(null);
            });
          }}
        >
          Sign out
        </button>
      </div>

      <div className="hedgerow-edit-layout">
        <nav className="hedgerow-edit-list" aria-label="Your posts">
          {docsError && (
            <p className="hedgerow-reply-error" role="alert">
              {docsError}
            </p>
          )}
          {docs === null && !docsError && <p className="hedgerow-edit-status">Loading your posts…</p>}
          {docs?.length === 0 && <p className="hedgerow-edit-status">No documents published yet.</p>}
          <ul>
            {docs?.map((doc) => (
              <li key={doc.uri}>
                <button
                  type="button"
                  className="hedgerow-edit-list-item"
                  data-selected={doc.uri === selectedUri ? "" : undefined}
                  onClick={() => setSelectedUri(doc.uri)}
                >
                  {doc.value.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hedgerow-edit-panel">
          {!selected && <p className="hedgerow-edit-status">Select a post to edit it.</p>}
          {selected && (
            <a className="hedgerow-edit-view-link" href={`/${slugOf(selected.value)}`} target="_blank" rel="noreferrer">
              View live post →
            </a>
          )}
          {selected && (
            <Editor.Root
              key={selected.uri}
              className="hedgerow-edit-form"
              document={documentFields}
              onSave={handleSave}
            >
              <label className="hedgerow-edit-label" htmlFor="hedgerow-edit-title">
                Title
              </label>
              <Editor.Title id="hedgerow-edit-title" className="hedgerow-edit-title" />

              <span className="hedgerow-edit-label">Body</span>
              <Editor.Body
                render={(slot) => (
                  <TiptapMarkdownEditor value={slot.value} onChange={slot.onChange} />
                )}
              />

              <div className="hedgerow-edit-actions">
                <Editor.Save className="hedgerow-edit-save" />
                <Editor.Status className="hedgerow-edit-status-part" />
              </div>
            </Editor.Root>
          )}
        </div>
      </div>
    </div>
  );
}
