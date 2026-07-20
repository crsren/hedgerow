// The headless engine behind `Editor.*` (SLIMS-64). Deliberately knows nothing
// about atproto, @hedgerow/publish, or @hedgerow/reader — the loaded document
// and the actual save are both injected (same shape as useReply's `session`/
// `onSubmit`), so this package stays dependency-thin (see docs/architecture.md's
// "react must not depend on publish/reader" rule) and works with whatever a
// consumer wires up (the demo composes it with @hedgerow/reader's
// asPublisher()).
import { useCallback, useState } from "react";

/**
 * The two fields Editor.* edits. Intentionally NOT the full
 * `site.standard.document` record shape — a consumer's `onSave` receives just
 * these and is responsible for merging them back into whatever record shape
 * it writes (see the demo's EditorIsland.tsx for the reference).
 */
export interface EditorFields {
  title: string;
  markdown: string;
}

/**
 * Where the editor currently sits: loading → idle → dirty → saving →
 * saved/error. "idle" is the loaded-but-unedited/clean state — a freshly
 * loaded document, or one just saved and then left untouched (a *new* save
 * afterwards goes dirty → saving → saved again, same as the first edit).
 */
export type EditorStatus = "loading" | "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseEditorOptions {
  /**
   * The document to edit, or `null` while it's still loading (before the
   * consumer has fetched/resolved which record to edit). A NEW object
   * reference (e.g. the consumer switched to editing a different post) resets
   * the fields and the status back to "idle" — re-renders with the SAME
   * reference never clobber in-progress, unsaved edits.
   */
  document: EditorFields | null;
  /** Persist the current fields. A rejection sets `status` to `"error"` and keeps the edited fields. */
  onSave: (fields: EditorFields) => Promise<void>;
}

export interface UseEditorReturn {
  status: EditorStatus;
  isLoading: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isSaved: boolean;
  isError: boolean;
  error: unknown;
  title: string;
  markdown: string;
  setTitle: (title: string) => void;
  setMarkdown: (markdown: string) => void;
  /** Persist the current fields. No-ops unless `status` is `"dirty"`. */
  save: () => Promise<void>;
}

export function useEditor(options: UseEditorOptions): UseEditorReturn {
  const { document, onSave } = options;

  // React-endorsed "adjust state during render" pattern (see the React docs'
  // "Storing information from previous renders"): comparing the incoming
  // `document` reference against what we last synced from, and calling a
  // setter mid-render when it changed, is how a NEW document resets the
  // fields on the very first render that has it — no useEffect flash of
  // stale values, and re-renders with the same reference are a no-op.
  const [syncedFrom, setSyncedFrom] = useState<EditorFields | null>(null);
  const [title, setTitleState] = useState("");
  const [markdown, setMarkdownState] = useState("");
  const [status, setStatus] = useState<EditorStatus>("loading");
  const [error, setError] = useState<unknown>(undefined);

  if (document !== syncedFrom) {
    setSyncedFrom(document);
    if (document) {
      setTitleState(document.title);
      setMarkdownState(document.markdown);
      setStatus("idle");
    } else {
      setStatus("loading");
    }
  }

  const setTitle = useCallback((next: string) => {
    setTitleState(next);
    setStatus((s) => (s === "saving" || s === "loading" ? s : "dirty"));
  }, []);

  const setMarkdown = useCallback((next: string) => {
    setMarkdownState(next);
    setStatus((s) => (s === "saving" || s === "loading" ? s : "dirty"));
  }, []);

  const save = useCallback(async () => {
    if (status !== "dirty") return;
    setStatus("saving");
    setError(undefined);
    try {
      await onSave({ title, markdown });
      setStatus("saved");
    } catch (err) {
      setError(err);
      setStatus("error");
    }
  }, [status, title, markdown, onSave]);

  return {
    status,
    isLoading: status === "loading",
    isDirty: status === "dirty",
    isSaving: status === "saving",
    isSaved: status === "saved",
    isError: status === "error",
    error,
    title,
    markdown,
    setTitle,
    setMarkdown,
    save,
  };
}
