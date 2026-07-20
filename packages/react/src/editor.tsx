// The `Editor.*` namespace (SLIMS-64): a small, headless document editor over
// `useEditor`. Same rules as `Comments.*`/`Likes.*`/`Reply.*` — default
// element, state exposed to `render`/`className`/`style`, `data-*`
// reflection, zero styles.
//
// Deliberately has NO dependency on @hedgerow/publish or @hedgerow/reader (no
// Tiptap either, ever — see docs/architecture.md): `Editor.Root` takes
// `document` + `onSave` as props (both injected), so the consumer decides how
// to load a record and how to persist it. `Editor.Body` is a SLOT, not an
// editor: by default it's a plain `<textarea>` bound to the markdown string,
// but its `render` prop hands back `{ value, onChange }` for the markdown
// string specifically (not the DOM-props-merge contract every other part's
// `render` uses) — that's the seam a real editor (the demo mounts Tiptap
// there) plugs into.
import * as React from "react";
import { renderElement, dataAttrs, type ClassNameProp, type StyleProp, type HeadlessProps, type PartProps } from "./render";
import { EditorRootContext, useEditorContext } from "./context";
import { useEditor, type EditorFields, type EditorStatus, type UseEditorOptions, type UseEditorReturn } from "./useEditor";

// ── Root ─────────────────────────────────────────────────────────────────────

export interface EditorRootState {
  status: UseEditorReturn["status"];
  isLoading: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isSaved: boolean;
  isError: boolean;
}

export interface EditorRootProps
  extends UseEditorOptions,
    HeadlessProps<EditorRootState>,
    Omit<
      React.ComponentPropsWithoutRef<"form">,
      "className" | "style" | "children" | "onSubmit" | "defaultValue"
    > {}

/**
 * Provider + container. Runs the editor's state machine and exposes it to
 * every nested part via context. Renders a `<form>` by default (so both an
 * `Editor.Save` click and a Ctrl/Cmd+Enter-triggered submit in a custom body
 * work) whose native submit is intercepted and routed to `save()`.
 */
export const Root = React.forwardRef<HTMLFormElement, EditorRootProps>(function EditorRoot(
  { document, onSave, render, className, style, children, ...rest },
  ref,
) {
  const value = useEditor({ document, onSave });

  const state: EditorRootState = {
    status: value.status,
    isLoading: value.isLoading,
    isDirty: value.isDirty,
    isSaving: value.isSaving,
    isSaved: value.status === "saved",
    isError: value.isError,
  };

  const element = renderElement("form", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      ...rest,
      onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void value.save();
      },
      ...dataAttrs({
        status: value.status,
        loading: value.isLoading,
        dirty: value.isDirty,
        saving: value.isSaving,
        saved: value.status === "saved",
        error: value.isError,
      }),
      children,
    },
  });

  return <EditorRootContext.Provider value={value}>{element}</EditorRootContext.Provider>;
});

// ── Title ────────────────────────────────────────────────────────────────────

export interface EditorTitleState {
  value: string;
  isLoading: boolean;
  isSaving: boolean;
}

export type EditorTitleProps = HeadlessProps<EditorTitleState> &
  Omit<React.ComponentPropsWithoutRef<"input">, "className" | "style" | "children" | "value" | "onChange">;

/** The document title `<input>`, controlled by `Editor.Root`'s state. */
export const Title = React.forwardRef<HTMLInputElement, EditorTitleProps>(function EditorTitle(
  { render, className, style, ...rest },
  ref,
) {
  const ctx = useEditorContext();
  const state: EditorTitleState = { value: ctx.title, isLoading: ctx.isLoading, isSaving: ctx.isSaving };

  return renderElement("input", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      type: "text",
      ...rest,
      value: ctx.title,
      disabled: ctx.isLoading || rest.disabled,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => ctx.setTitle(event.target.value),
      ...dataAttrs({ loading: ctx.isLoading, saving: ctx.isSaving }),
    },
  });
});

// ── Body (headless slot) ────────────────────────────────────────────────────

/** What `Editor.Body`'s `render` is called with: the markdown string and a setter — NOT DOM props. */
export interface EditorBodySlot {
  value: string;
  onChange: (value: string) => void;
}

export interface EditorBodyState {
  value: string;
  isLoading: boolean;
  isSaving: boolean;
}

export interface EditorBodyProps
  extends Omit<React.ComponentPropsWithoutRef<"textarea">, "className" | "style" | "children" | "value" | "onChange"> {
  /** className/style for the DEFAULT `<textarea>` only — ignored once `render` takes over. */
  className?: ClassNameProp<EditorBodyState>;
  style?: StyleProp<EditorBodyState>;
  /**
   * The mount point for a real rich-text editor (the demo mounts Tiptap
   * here). Called with `{ value, onChange }` for the markdown string — NOT
   * this library's usual `(props, state) => ReactElement` contract, since a
   * non-DOM editor component has nothing sensible to do with spread DOM
   * attributes. Omit it to get the default plain `<textarea>` instead — that
   * default IS the full extent of what this package renders for a body; it
   * never ships an editor of its own.
   */
  render?: (slot: EditorBodySlot) => React.ReactNode;
}

export const Body = React.forwardRef<HTMLTextAreaElement, EditorBodyProps>(function EditorBody(
  { render, className, style, ...rest },
  ref,
) {
  const ctx = useEditorContext();

  if (render) {
    return <>{render({ value: ctx.markdown, onChange: ctx.setMarkdown })}</>;
  }

  const state: EditorBodyState = { value: ctx.markdown, isLoading: ctx.isLoading, isSaving: ctx.isSaving };
  const resolvedClassName = typeof className === "function" ? className(state) : className;
  const resolvedStyle = typeof style === "function" ? style(state) : style;

  return (
    <textarea
      ref={ref}
      {...rest}
      className={resolvedClassName}
      style={resolvedStyle}
      value={ctx.markdown}
      disabled={ctx.isLoading || rest.disabled}
      onChange={(event) => ctx.setMarkdown(event.target.value)}
      {...dataAttrs({ loading: ctx.isLoading, saving: ctx.isSaving })}
    />
  );
});

// ── Save ─────────────────────────────────────────────────────────────────────

export interface EditorSaveState {
  isDirty: boolean;
  isSaving: boolean;
  isDisabled: boolean;
}

export type EditorSaveProps = PartProps<EditorSaveState, "button">;

/** The save button. Disabled unless the document is dirty (or while saving). Defaults to "Save" / "Saving…". */
export const Save = React.forwardRef<HTMLButtonElement, EditorSaveProps>(function EditorSave(
  { render, className, style, children, ...rest },
  ref,
) {
  const ctx = useEditorContext();
  const isDisabled = !ctx.isDirty || ctx.isSaving;
  const state: EditorSaveState = { isDirty: ctx.isDirty, isSaving: ctx.isSaving, isDisabled };

  return renderElement("button", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      type: "submit",
      ...rest,
      disabled: isDisabled,
      ...dataAttrs({ dirty: ctx.isDirty, saving: ctx.isSaving, disabled: isDisabled }),
      children: children ?? (ctx.isSaving ? "Saving…" : "Save"),
    },
  });
});

// ── Status ───────────────────────────────────────────────────────────────────

export interface EditorStatusState {
  status: EditorStatus;
  error: unknown;
}

export type EditorStatusProps = PartProps<EditorStatusState, "div">;

const DEFAULT_STATUS_LABEL: Record<EditorStatus, string> = {
  loading: "Loading…",
  editing: "",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

/** Always-rendered status readout (loading/editing/dirty/saving/saved/error). Exposes the save error via `state.error` and `role="alert"` when errored. */
export const Status = React.forwardRef<HTMLDivElement, EditorStatusProps>(function EditorStatusPart(
  { render, className, style, children, ...rest },
  ref,
) {
  const ctx = useEditorContext();
  const state: EditorStatusState = { status: ctx.status, error: ctx.error };

  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      ...(ctx.status === "error" ? { role: "alert" } : {}),
      ...rest,
      ...dataAttrs({ status: ctx.status, error: ctx.isError }),
      children: children ?? DEFAULT_STATUS_LABEL[ctx.status],
    },
  });
});

export type { EditorFields, EditorStatus };
