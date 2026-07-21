// The `Reply.*` namespace: a small, headless reply composer over `useReply`.
// Same rules as `Comments.*`/`Likes.*` — default element, state exposed to
// `render`/`className`/`style`, `data-*` reflection, zero styles.
//
// Deliberately has NO dependency on @hedgerow/reader (or any auth library):
// `Reply.Root` takes `session` and `onSubmit` as props, so the consumer wires
// up whichever atproto OAuth client (or mock) they like. This is what keeps
// the package dependency-thin — see docs/architecture.md.
import * as React from "react";
import { renderElement, dataAttrs, type SubmitHandler, type HeadlessProps, type PartProps } from "./render";
import { ReplyRootContext, useReplyContext } from "./context";
import { useReply, type ReplySession, type UseReplyOptions, type UseReplyReturn } from "./useReply";

// ── Root ─────────────────────────────────────────────────────────────────────

export interface ReplyRootState {
  status: UseReplyReturn["status"];
  isSignedIn: boolean;
  isSubmitting: boolean;
  isError: boolean;
}

export interface ReplyRootProps
  extends UseReplyOptions,
    HeadlessProps<ReplyRootState>,
    Omit<
      React.ComponentPropsWithoutRef<"form">,
      "className" | "style" | "children" | "onSubmit" | "defaultValue"
    > {}

/**
 * Provider + container. Runs the composer's state machine and exposes it to
 * every nested part via context. Renders a `<form>` by default (so both a
 * `Reply.Submit` click and pressing Enter in `Reply.Field` submit) whose
 * native submit is intercepted and routed to `onSubmit`.
 */
export const Root = React.forwardRef<HTMLFormElement, ReplyRootProps>(function ReplyRoot(
  { session, onSubmit, onSubmitted, defaultValue, render, className, style, children, ...rest },
  ref,
) {
  const value = useReply({
    session,
    onSubmit,
    ...(onSubmitted !== undefined ? { onSubmitted } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  });

  const state: ReplyRootState = {
    status: value.status,
    isSignedIn: value.isSignedIn,
    isSubmitting: value.isSubmitting,
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
      // Event type is inferred from SubmitHandler, which React declares
      // differently on 18 vs 19 — see its definition in render.ts.
      onSubmit: ((event) => {
        event.preventDefault();
        void value.submit();
      }) as SubmitHandler,
      ...dataAttrs({
        status: value.status,
        "signed-in": value.isSignedIn,
        submitting: value.isSubmitting,
        error: value.isError,
      }),
      children,
    },
  });

  return <ReplyRootContext.Provider value={value}>{element}</ReplyRootContext.Provider>;
});

// ── Field ────────────────────────────────────────────────────────────────────

export interface ReplyFieldState {
  value: string;
  isSubmitting: boolean;
  isSignedIn: boolean;
}

/**
 * `value`/`onChange` are intentionally NOT exposed here — the field is always
 * bound to `Reply.Root`'s own state via context. For a fully custom input,
 * read `value`/`setValue` off `useReplyContext()` yourself (the same escape
 * hatch `useCommentsContext()` gives a custom sort control).
 */
export type ReplyFieldProps = HeadlessProps<ReplyFieldState> &
  Omit<React.ComponentPropsWithoutRef<"textarea">, "className" | "style" | "children" | "value" | "onChange">;

/** The reply text `<textarea>`, controlled by `Reply.Root`'s state. */
export const Field = React.forwardRef<HTMLTextAreaElement, ReplyFieldProps>(function ReplyField(
  { render, className, style, ...rest },
  ref,
) {
  const ctx = useReplyContext();
  const state: ReplyFieldState = { value: ctx.value, isSubmitting: ctx.isSubmitting, isSignedIn: ctx.isSignedIn };

  return renderElement("textarea", {
    state,
    render,
    className,
    style,
    ref,
    props: {
      ...rest,
      value: ctx.value,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => ctx.setValue(event.target.value),
      ...dataAttrs({ submitting: ctx.isSubmitting, "signed-in": ctx.isSignedIn }),
    },
  });
});

// ── Submit ───────────────────────────────────────────────────────────────────

export interface ReplySubmitState {
  isSubmitting: boolean;
  isDisabled: boolean;
  isSignedIn: boolean;
}

export type ReplySubmitProps = PartProps<ReplySubmitState, "button">;

/** The submit button. Disabled while submitting or the field is empty. Defaults to "Reply" / "Posting…". */
export const Submit = React.forwardRef<HTMLButtonElement, ReplySubmitProps>(function ReplySubmit(
  { render, className, style, children, ...rest },
  ref,
) {
  const ctx = useReplyContext();
  const isDisabled = ctx.isSubmitting || ctx.value.trim().length === 0;
  const state: ReplySubmitState = { isSubmitting: ctx.isSubmitting, isDisabled, isSignedIn: ctx.isSignedIn };

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
      ...dataAttrs({ submitting: ctx.isSubmitting, disabled: isDisabled }),
      children: children ?? (ctx.isSubmitting ? "Posting…" : "Reply"),
    },
  });
});

// ── Conditional session slots ────────────────────────────────────────────────

export type ReplySignedInProps = PartProps<Record<string, never>, "div">;

/** Renders only when `Reply.Root`'s `session` is non-null. */
export const SignedIn = React.forwardRef<HTMLDivElement, ReplySignedInProps>(function ReplySignedIn(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isSignedIn } = useReplyContext();
  if (!isSignedIn) return null;
  return renderElement("div", {
    state: {},
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ "signed-in": true }), children },
  });
});

export type ReplySignedOutProps = PartProps<Record<string, never>, "div">;

/** Renders only when `Reply.Root`'s `session` is null. */
export const SignedOut = React.forwardRef<HTMLDivElement, ReplySignedOutProps>(function ReplySignedOut(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isSignedIn } = useReplyContext();
  if (isSignedIn) return null;
  return renderElement("div", {
    state: {},
    render,
    className,
    style,
    ref,
    props: { ...rest, ...dataAttrs({ "signed-out": true }), children },
  });
});

// ── Error ────────────────────────────────────────────────────────────────────

export interface ReplyErrorState {
  error: unknown;
}

export type ReplyErrorProps = PartProps<ReplyErrorState, "div">;

/** Renders only when the last submit failed; exposes the error to `render`/children. */
export const ErrorMessage = React.forwardRef<HTMLDivElement, ReplyErrorProps>(function ReplyError(
  { render, className, style, children, ...rest },
  ref,
) {
  const { isError, error } = useReplyContext();
  if (!isError) return null;
  const state: ReplyErrorState = { error };
  return renderElement("div", {
    state,
    render,
    className,
    style,
    ref,
    props: { role: "alert", ...rest, ...dataAttrs({ error: true }), children },
  });
});

export type { ReplySession };
