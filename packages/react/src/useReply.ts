// The headless engine behind `Reply.*`. Deliberately knows nothing about
// atproto OAuth or @hedgerow/reader — session and the actual write are both
// injected, so this package stays dependency-thin (see docs/architecture.md's
// "react must not depend on reader" rule) and works with any auth a consumer
// wires up.
import { useCallback, useState } from "react";

/** Where the composer currently sits. */
export type ReplyStatus = "idle" | "submitting" | "error";

/** The minimal signed-in identity `Reply.*` needs — a structural subset of
 * `@hedgerow/reader`'s `ReaderSession`, duck-typed so this package never
 * imports it. */
export interface ReplySession {
  did: string;
  handle: string;
  displayName?: string;
}

export interface UseReplyOptions {
  /** The signed-in reader, or `null` when signed out. Drives `Reply.SignedIn` / `Reply.SignedOut`. */
  session: ReplySession | null;
  /**
   * Write the reply. A rejection sets `status` to `"error"` and keeps the
   * field's text so the reader can retry. Resolving normally (or to
   * `undefined`) clears the field, returns to `"idle"`, and fires
   * `onSubmitted` — the ordinary "it posted" path.
   *
   * Resolve to `false` instead when the submit was **intercepted** rather
   * than posted — e.g. an auth-on-demand gate that needs a session before it
   * can write anything, triggered from inside `onSubmit` itself. Like a
   * rejection, this keeps the field's text (never cleared); unlike a
   * rejection, `status` returns to `"idle"` rather than `"error"` (nothing
   * failed — the consumer is handling it, typically by opening its own UI)
   * and `onSubmitted` is not called (nothing was actually submitted).
   */
  onSubmit: (text: string) => Promise<void | false>;
  /** Called once, after a successful submit has cleared the field. */
  onSubmitted?: () => void;
  /** Initial field text (uncontrolled). Default `""`. */
  defaultValue?: string;
}

export interface UseReplyReturn {
  session: ReplySession | null;
  isSignedIn: boolean;
  status: ReplyStatus;
  isSubmitting: boolean;
  isError: boolean;
  error: unknown;
  /** The field's current text. */
  value: string;
  setValue: (value: string) => void;
  /** Submit the current (trimmed) value. No-ops while already submitting or empty. */
  submit: () => Promise<void>;
}

export function useReply(options: UseReplyOptions): UseReplyReturn {
  const { session, onSubmit, onSubmitted, defaultValue = "" } = options;
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<ReplyStatus>("idle");
  const [error, setError] = useState<unknown>(undefined);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text || status === "submitting") return;
    setStatus("submitting");
    setError(undefined);
    try {
      const result = await onSubmit(text);
      if (result === false) {
        // Intercepted, not posted — see UseReplyOptions.onSubmit. The field's
        // text is deliberately left alone (not cleared) and this isn't an
        // error, so no Reply.Error either.
        setStatus("idle");
        return;
      }
      setValue("");
      setStatus("idle");
      onSubmitted?.();
    } catch (err) {
      setError(err);
      setStatus("error");
    }
  }, [value, status, onSubmit, onSubmitted]);

  return {
    session,
    isSignedIn: session != null,
    status,
    isSubmitting: status === "submitting",
    isError: status === "error",
    error,
    value,
    setValue,
    submit,
  };
}
