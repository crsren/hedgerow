// The SLIMS-54 dogfood island, extended by SLIMS-66 (reply-in-place), SLIMS-69
// (in-place likes + full comment interactions), and now the
// interaction-first/auth-on-demand redesign: every interactive affordance
// (post like, per-comment like/reply, the reply composer) renders enabled for
// EVERYONE, signed in or not. A gated action taken while signed out (submit,
// like) opens a "Join the conversation" modal instead of hiding the
// affordance up front — see AuthGateDialog below, and @hedgerow/react's
// README ("Auth on demand") for the general pattern this demo is the
// reference implementation of.
//
// A client-hydrated comment thread + like count + reply box, all rendered
// with the headless @hedgerow/react parts — this file doubles as the
// reference for how a consumer styles them (className + data-* selectors,
// render props for custom markup) AND for how to wire @hedgerow/reader's
// browser OAuth reader identity into Comments.*/Likes.*/Reply.* (react has no
// dependency on reader itself — see docs/architecture.md). All styling lives
// in comment-thread.css; the article above stays fully static.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  Comments,
  Likes,
  Reply,
  mergeRefs,
  useCommentsContext,
  useReplyContext,
  type Comment,
  type LikesResult,
  type ThreadResult,
} from "@hedgerow/react";
import type { ReaderSession, StrongRef } from "@hedgerow/reader";
import { appViewOverride, reader, signupServiceOverride } from "../lib/reader";
import "./comment-thread.css";

/** Where the reply composer is currently aimed — null means the root post. */
interface ReplyTarget {
  uri: string;
  cid: string;
  handle: string;
}

/** The gated action an auth-on-demand modal is standing in for. */
type PendingAction = { kind: "reply" } | { kind: "like"; subject: StrongRef };

// Shared across ReplyBox / PostLikeButton / LikeStatusPrefetch / the pending-
// like appliers, all mounted as siblings deep inside <Comments.Root> — a tiny
// demo-local context beats threading half a dozen values through every
// intermediate template layer.
interface ReaderSessionContextValue {
  /** undefined = still resuming; null = signed out; object = signed in. */
  session: ReaderSession | null | undefined;
  setSession: (session: ReaderSession | null) => void;
  /**
   * Open the auth-gate modal for a like taken while signed out (a reply
   * submit's own gate lives in ReplyBox/Reply.Root's onSubmit instead, since
   * that's where `useReply`'s "intercepted, keep the draft" contract lives —
   * see useReply's README doc). Doesn't snapshot anything itself;
   * AuthGateDialog reads the live draft/replyTarget at the moment the reader
   * actually commits to signing in, not at the moment the gate opens.
   */
  openAuthGate: (pendingAction: PendingAction) => void;
  /**
   * The composer's current text, mirrored here by DraftSync (a child of
   * Reply.Root — see below) so a gate triggered OUTSIDE Reply.Root's own
   * subtree (the post-level and per-comment Like buttons) can still snapshot
   * "whatever the reader was mid-typing" into the auth-intent stash.
   */
  draftRef: MutableRefObject<string>;
  /**
   * A "like" intent restored from sessionStorage after an OAuth redirect,
   * not yet applied — see PostLikeButton (root post) and
   * PendingCommentLikeApplier (everything else). Cleared via
   * consumePendingLike() once acted on, so it fires exactly once.
   */
  pendingLikeSubject: StrongRef | null;
  consumePendingLike: () => void;
}
const ReaderSessionContext = createContext<ReaderSessionContextValue>({
  session: undefined,
  setSession: () => {},
  openAuthGate: () => {},
  draftRef: { current: "" },
  pendingLikeSubject: null,
  consumePendingLike: () => {},
});
const useReaderSession = () => useContext(ReaderSessionContext);

// ── Auth-intent stash (survives the OAuth redirect) ─────────────────────────
//
// signIn()/signUp() navigate the browser away entirely (real Bluesky OAuth,
// even against the local dev-net — see docs/local-testing.md), so any
// in-memory React state is gone by the time the reader lands back on this
// same page path. sessionStorage is the one thing that survives that trip.
// Keyed by `post` (the prop this component was given, NOT the thread's
// resolved at:// uri) specifically because it's the one identifier available
// synchronously at this component's very first render — before Comments.Root
// has even mounted, let alone resolved the thread — and it's stable across
// the redirect (the reader signs in from, and returns to, the exact same
// page/prop).

interface StashedAuthIntent {
  draft: string;
  replyTarget: ReplyTarget | null;
  pendingAction: PendingAction;
  /** Best-effort fallback for scroll restoration — see the rehydration
   * effect's comment on why scrolling to the composer element is used
   * instead as the primary mechanism. */
  scrollY: number;
}

const authIntentKey = (post: string) => `hedgerow:auth-intent:${post}`;

function readStashedIntent(post: string): StashedAuthIntent | null {
  if (typeof window === "undefined") return null; // SSR — sessionStorage doesn't exist server-side
  try {
    const raw = window.sessionStorage.getItem(authIntentKey(post));
    return raw ? (JSON.parse(raw) as StashedAuthIntent) : null;
  } catch {
    return null; // private-mode/quota storage errors — not fatal, just no rehydration
  }
}

function writeStashedIntent(post: string, intent: StashedAuthIntent): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(authIntentKey(post), JSON.stringify(intent));
  } catch {
    // Best-effort — a failed stash just means the redirect comes back to an
    // empty composer instead of a restored one; not worth surfacing to the reader.
  }
}

function clearStashedIntent(post: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(authIntentKey(post));
  } catch {
    // ignore
  }
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 hours ago" style label, falling back to seconds. */
function relativeTime(date: Date): string {
  const diff = date.getTime() - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RTF.format(Math.round(diff / ms), unit);
  }
  return RTF.format(Math.round(diff / 1000), "second");
}

/** Hooks-only consumer of the thread context: the root post's true likeCount
 * (getLikes pages have no grand total), rendered only once stats have loaded
 * so there's no "0 likes" flash. */
function LikeCount() {
  const { stats } = useCommentsContext();
  if (!stats) return null;
  return (
    <span className="hedgerow-likecount">
      {stats.likeCount === 1 ? "1 like" : `${stats.likeCount} likes`}
    </span>
  );
}

/** `N like(s)` — shared by the post-level and per-comment like buttons'
 * aria-label (point 7 of the redesign: a count-bearing label beats a bare
 * heart glyph for assistive tech). */
const likeAriaLabel = (count: number): string => `Like — ${count} ${count === 1 ? "like" : "likes"}`;

/**
 * The "like the post" toggle (SLIMS-69), next to LikeCount. Reads the
 * reader's own like state via findLike on mount (no authenticated AppView to
 * ask directly — see @hedgerow/reader's README), then wires Likes.Button's
 * injected liked/onLike/onUnlike straight to reader.like()/unlike().
 *
 * Interaction-first: renders enabled for everyone, signed in or not (no more
 * `disabled={!session}`). A signed-out click opens the auth gate instead of
 * liking — see onLike below and the README's "Auth on demand" recipe.
 */
function PostLikeButton() {
  const { data, root, stats, refetch } = useCommentsContext();
  const { session, openAuthGate, pendingLikeSubject, consumePendingLike } = useReaderSession();
  // undefined = still checking; null = confirmed not liked; string = this
  // reader's own like record uri (needed to unlike()).
  const [likeUri, setLikeUri] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!session || !data) return;
    let cancelled = false;
    reader.findLike(data.uri).then((uri) => {
      if (!cancelled) setLikeUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [session, data?.uri]);

  // A "like" intent restored from sessionStorage after an OAuth redirect,
  // targeting THIS post specifically — applied automatically once signed in
  // (point 3: unlike a pending reply, a pending like is NOT held back for a
  // deliberate click, since liking already fully expresses the intent).
  const appliedPendingRef = useRef(false);
  useEffect(() => {
    if (!session || !data || !pendingLikeSubject || appliedPendingRef.current) return;
    if (pendingLikeSubject.uri !== data.uri) return; // not the post — PendingCommentLikeApplier's job
    appliedPendingRef.current = true;
    reader.like(pendingLikeSubject).then((ref) => {
      setLikeUri(ref.uri);
      consumePendingLike();
      refetch();
    });
  }, [session, data, pendingLikeSubject, consumePendingLike, refetch]);

  if (!data || !root || root.type !== "comment") return null;
  const subject: StrongRef = { uri: data.uri, cid: root.cid };

  // Signed out: never "liked" (there's no session to ask, nothing's been
  // fetched), but reported as `false` rather than `undefined` — see
  // useLikeButton's own doc comment on why `undefined` ("unknown, still
  // resolving") disables the toggle while a confident `false` does not. That
  // keeps this button live for a signed-out reader: a click still fires
  // onLike below, which is where the auth gate opens.
  const liked = !session ? false : likeUri === undefined ? undefined : likeUri !== null;

  return (
    <Likes.Button
      className="hedgerow-like-button"
      liked={liked}
      count={stats?.likeCount ?? 0}
      render={(props, state) => <button {...props} aria-label={likeAriaLabel(state.count)} />}
      // Likes.Button's own optimistic overlay gives instant feedback on the
      // button itself; refetch() afterwards is what brings the *other*
      // count on the page — LikeCount's "N likes" text, driven by
      // stats.likeCount — into agreement with it. The local AppView shim
      // recomputes likeCount live off the PDS on every request (no indexing
      // lag), so in practice this converges immediately; a real deployment
      // could take a moment to index, same as any other engagement count.
      onLike={() => {
        if (!session) {
          openAuthGate({ kind: "like", subject });
          // useLikeButton only rolls its optimistic "liked" flip back on a
          // REJECTION (see its own doc comment: "Not rethrown... A consumer
          // that wants to react to the failure does so inside their own
          // onLike/onUnlike"). Throwing here IS that rejection — deliberate
          // reuse of the existing contract rather than a new one: the flip
          // and the rollback both happen inside the same microtask/React
          // batch, so nothing visibly flashes "liked" before it reverts, and
          // the modal is the actual feedback the reader sees.
          throw new Error("hedgerow: signed out — opened the auth gate instead of liking");
        }
        return reader.like(subject).then((ref) => setLikeUri(ref.uri)).then(refetch);
      }}
      onUnlike={() =>
        likeUri ? reader.unlike(likeUri).then(() => setLikeUri(null)).then(refetch) : undefined
      }
    />
  );
}

/**
 * Warms a `{ uri -> like record uri | null }` cache for every comment
 * currently in the (sorted/filtered) tree, so `Comments.LikeButton`'s
 * `isCommentLiked` has an answer without a lookup per row per render. Renders
 * nothing — purely a `useCommentsContext()` + effect wrapper, which is why it
 * has to live INSIDE `<Comments.Root>` even though the cache itself is owned
 * by the top-level `CommentThread` component (passed down as props) so
 * `onLikeComment`/`onUnlikeComment`/`isCommentLiked` — which `Comments.Root`
 * itself needs — can read it too.
 */
function LikeStatusPrefetch({
  likedByUri,
  setLikedByUri,
}: {
  likedByUri: Record<string, string | null>;
  setLikedByUri: Dispatch<SetStateAction<Record<string, string | null>>>;
}) {
  const { comments } = useCommentsContext();
  const { session } = useReaderSession();
  // Avoids re-fetching a uri already in state without making the effect
  // depend on (and therefore re-run for every change to) that same state.
  const cachedRef = useRef(likedByUri);
  cachedRef.current = likedByUri;

  useEffect(() => {
    if (!session) return;
    const toCheck = collectComments(comments).filter((c) => !(c.uri in cachedRef.current));
    if (toCheck.length === 0) return;
    let cancelled = false;
    Promise.all(toCheck.map(async (c) => [c.uri, await reader.findLike(c.uri)] as const)).then((results) => {
      if (cancelled) return;
      setLikedByUri((prev) => {
        const next = { ...prev };
        for (const [uri, likeUri] of results) next[uri] = likeUri;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [session, comments, setLikedByUri]);

  return null;
}

/**
 * Auto-performs a "like" intent restored from sessionStorage after an OAuth
 * redirect (point 3: "for a pending like, perform it automatically") when the
 * stashed subject is a COMMENT rather than the root post — PostLikeButton
 * claims the root-post case itself (it already owns that like/unlike state).
 * Renders nothing; lives inside `<Comments.Root>` so it can read `data` (the
 * root post) to tell the two apart.
 */
function PendingCommentLikeApplier({
  setLikedByUri,
}: {
  setLikedByUri: Dispatch<SetStateAction<Record<string, string | null>>>;
}) {
  const { data } = useCommentsContext();
  const { session, pendingLikeSubject, consumePendingLike } = useReaderSession();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!session || !data || !pendingLikeSubject || firedRef.current) return;
    if (pendingLikeSubject.uri === data.uri) return; // the root post — PostLikeButton's job
    firedRef.current = true;
    reader.like(pendingLikeSubject).then((ref) => {
      setLikedByUri((prev) => ({ ...prev, [pendingLikeSubject.uri]: ref.uri }));
      consumePendingLike();
    });
  }, [session, data, pendingLikeSubject, consumePendingLike, setLikedByUri]);

  return null;
}

function collectComments(nodes: readonly { type: string }[]): Comment[] {
  const out: Comment[] = [];
  for (const node of nodes) {
    if (node.type === "comment") {
      const comment = node as Comment;
      out.push(comment);
      out.push(...collectComments(comment.replies));
    }
  }
  return out;
}

/**
 * Mirrors Reply.Root's own composer text into a ref the auth-gate machinery
 * can read from OUTSIDE Reply.Root's subtree (the post-level and per-comment
 * Like buttons, and AuthGateDialog's stash-on-login-click) — see
 * ReaderSessionContextValue.draftRef. Reply.Field's value is intentionally
 * not exposed as a controlled prop (see @hedgerow/react's README), so
 * useReplyContext() — usable only inside Reply.Root — is the only way in.
 * Renders nothing.
 */
function DraftSync({ draftRef }: { draftRef: MutableRefObject<string> }) {
  const { value } = useReplyContext();
  useEffect(() => {
    draftRef.current = value;
  }, [draftRef, value]);
  return null;
}

/**
 * "Join the conversation" — the auth-on-demand gate (point 2 of the
 * interaction-first redesign). Opened by a signed-out submit or like; native
 * `<dialog>.showModal()` gives focus-trapping, Esc-to-close, and focus-return
 * on close all for free — no extra JS needed for any of that. Two ways
 * forward, both redirecting to real Bluesky OAuth (even against the local
 * dev-net — see docs/local-testing.md): log in with an existing handle, or
 * `reader.signUp()` (prompt: "create", same path the old inline signup link
 * used). Whichever is chosen, the CURRENT draft/reply-target/pending-action
 * is stashed to sessionStorage (keyed by `post`) right before the redirect —
 * see the module-level read/writeStashedIntent and CommentThread's
 * rehydration effect for the other half of this round trip.
 */
function AuthGateDialog({
  post,
  pendingAction,
  draftRef,
  replyTarget,
  onClose,
}: {
  post: string;
  pendingAction: PendingAction;
  draftRef: MutableRefObject<string>;
  replyTarget: ReplyTarget | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [handleInput, setHandleInput] = useState("");
  const [busy, setBusy] = useState<"signin" | "signup" | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // Fires on Esc (the browser's own built-in "cancel" → "close" sequence —
    // no code needed for that part) AND on the Cancel button's dialog.close()
    // below; one handler covers both. Focus returning to whatever triggered
    // the gate is also native <dialog> behavior that comes free with
    // showModal(), independent of this listener.
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  function stash(): void {
    writeStashedIntent(post, {
      draft: draftRef.current,
      replyTarget,
      pendingAction,
      scrollY: window.scrollY,
    });
  }

  async function handleLogIn() {
    const handle = handleInput.trim();
    if (!handle || busy) return;
    setBusy("signin");
    setAuthError(null);
    stash();
    try {
      await reader.signIn(handle); // redirects; only returns on failure/abort
    } catch (err) {
      clearStashedIntent(post); // the redirect never happened — don't leave a stale stash behind
      setAuthError(err instanceof Error ? err.message : "Could not start login.");
      setBusy(null);
    }
  }

  async function handleSignUp() {
    if (busy) return;
    setBusy("signup");
    setAuthError(null);
    stash();
    try {
      await reader.signUp(signupServiceOverride); // redirects; only returns on failure/abort
    } catch (err) {
      clearStashedIntent(post);
      setAuthError(err instanceof Error ? err.message : "Could not start signup.");
      setBusy(null);
    }
  }

  return (
    <dialog ref={dialogRef} className="hedgerow-auth-dialog" aria-labelledby="hedgerow-auth-dialog-title">
      <form
        className="hedgerow-auth-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleLogIn();
        }}
      >
        <h2 id="hedgerow-auth-dialog-title" className="hedgerow-auth-dialog-title">
          Join the conversation
        </h2>
        <p className="hedgerow-auth-dialog-honesty">Posts publicly on Bluesky as @you.</p>

        <div className="hedgerow-auth-dialog-login">
          <input
            type="text"
            aria-label="Your Bluesky handle"
            className="hedgerow-auth-dialog-handle"
            placeholder="your-handle.bsky.social"
            value={handleInput}
            onChange={(event) => setHandleInput(event.target.value)}
            disabled={busy !== null}
            autoFocus
          />
          <button
            type="submit"
            className="hedgerow-auth-dialog-login-button"
            disabled={busy !== null || !handleInput.trim()}
          >
            {busy === "signin" ? "Redirecting…" : "Log in with Bluesky"}
          </button>
        </div>

        <p className="hedgerow-auth-dialog-signup">
          New here?{" "}
          <button
            type="button"
            className="hedgerow-auth-dialog-signup-button"
            onClick={handleSignUp}
            disabled={busy !== null}
          >
            {busy === "signup" ? "Redirecting…" : "Sign up with Bluesky"}
          </button>{" "}
          — you'll approve access on your Bluesky server and land right back here.{" "}
          <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">
            (or create an account on bsky.app)
          </a>
        </p>

        {authError && (
          <p className="hedgerow-auth-dialog-error" role="alert">
            {authError}
          </p>
        )}

        <div className="hedgerow-auth-dialog-actions">
          <button type="button" className="hedgerow-auth-dialog-cancel" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * The reply-in-place composer (SLIMS-66), extended by SLIMS-69 to retarget
 * (one composer instance, aimed at either the root post or a specific
 * comment) and now by the interaction-first redesign to render fully
 * unconditionally: Reply.Field/Reply.Submit are no longer wrapped in
 * Reply.SignedOut/Reply.SignedIn — a signed-out reader can type and even
 * attempt to submit a full reply (compose-first). Only the actual submit
 * gates on a session, via handleSubmit below.
 */
function ReplyBox({
  replyTarget,
  onCancelReplyTarget,
  initialDraft,
  draftRef,
}: {
  replyTarget: ReplyTarget | null;
  onCancelReplyTarget: () => void;
  /** Seeds Reply.Root's (uncontrolled) defaultValue — the draft restored
   * from a stashed auth intent, or "" on an ordinary page load. */
  initialDraft: string;
  draftRef: MutableRefObject<string>;
}) {
  const { data, root, addOptimisticReply } = useCommentsContext();
  const { session, setSession, openAuthGate } = useReaderSession();

  // No strongRef to reply against yet (still loading, or the root itself is a
  // deleted/blocked stub) — nothing sensible to render.
  if (!data || !root || root.type !== "comment") return null;
  const rootRef: StrongRef = { uri: data.uri, cid: root.cid };
  const parentRef: StrongRef = replyTarget ?? rootRef;

  async function handleSubmit(text: string): Promise<void | false> {
    if (!session) {
      // Compose-first, auth-on-demand: the composer stays fully usable while
      // signed out (see @hedgerow/react's README, "Auth on demand"); only the
      // actual submit gates. Resolving `false` — rather than throwing — is
      // useReply's "intercepted, not posted" contract: the draft text
      // survives untouched (never cleared) and status returns to "idle"
      // instead of "error", since nothing actually failed.
      openAuthGate({ kind: "reply" });
      return false;
    }
    const ref = await reader.createReply({ root: rootRef, parent: parentRef, text });
    addOptimisticReply({
      ref,
      parentUri: parentRef.uri,
      text,
      author: {
        did: session.did,
        handle: session.handle,
        ...(session.displayName ? { displayName: session.displayName } : {}),
      },
    });
    onCancelReplyTarget(); // back to replying-to-root once this send is in flight
    // Give the AppView/shim a few seconds to index the write — confirming/
    // unconfirming this optimistic entry as each refetch lands (see
    // @hedgerow/react's README "Optimistic replies") — is now built into
    // useComments' own addOptimisticReply via its confirmRetryDelays option
    // (default [2000, 4000, 6000], same schedule this demo used to hand-roll
    // here). Not awaited: the reply is already visible the instant this
    // function returns.
  }

  if (session === undefined) return null; // avoid a signed-out flash while resuming

  return (
    <Reply.Root className="hedgerow-reply-box" session={session} onSubmit={handleSubmit} defaultValue={initialDraft}>
      <DraftSync draftRef={draftRef} />

      {session && (
        <div className="hedgerow-reply-identity">
          <span>
            Replying as <strong>{session.displayName || session.handle}</strong>
          </span>
          <button
            type="button"
            className="hedgerow-reply-signout"
            onClick={() => {
              void reader.signOut().then(() => setSession(null));
            }}
          >
            Sign out
          </button>
        </div>
      )}

      {replyTarget && (
        <div className="hedgerow-reply-target">
          <span>
            Replying to <strong>@{replyTarget.handle}</strong>
          </span>
          <button type="button" className="hedgerow-reply-target-cancel" onClick={onCancelReplyTarget}>
            Cancel — reply to post instead
          </button>
        </div>
      )}

      <Reply.Field
        className="hedgerow-reply-field"
        id="hedgerow-reply-field"
        name="reply"
        aria-label="Write a reply"
        placeholder="Write a reply…"
        rows={3}
      />
      <div className="hedgerow-reply-actions">
        <Reply.Submit className="hedgerow-reply-submit" />
      </div>
      <Reply.Error className="hedgerow-reply-error">
        Couldn’t post your reply — please try again.
      </Reply.Error>
    </Reply.Root>
  );
}

export default function CommentThread({
  post,
  initialThread,
  initialLikes,
}: {
  post: string;
  initialThread?: ThreadResult;
  initialLikes?: LikesResult;
}) {
  // Perf, per SLIMS-54: from hydration (first render of this island) to the
  // first comment actually painting in the DOM. Logged to the console.
  const hydrationStart = useRef(performance.now());
  const measured = useRef(false);

  const measureFirstComment = useCallback((el: Element | null) => {
    if (!el || measured.current) return;
    measured.current = true;
    performance.mark("hedgerow:first-comment");
    const ms = performance.now() - hydrationStart.current;
    // eslint-disable-next-line no-console
    console.log(`[hedgerow] hydration → first comment rendered: ${ms.toFixed(1)}ms`);
  }, []);

  // Read once, synchronously, before the first paint — see readStashedIntent
  // above for why `post` (not the thread's resolved uri) is the key. NOT
  // cleared here: cleared once rehydration actually runs (the effect below),
  // so a reload that ISN'T an OAuth return (e.g. hitting refresh before ever
  // signing in) still finds it on the next attempt.
  const [initialIntent] = useState<StashedAuthIntent | null>(() => readStashedIntent(post));

  const [session, setSession] = useState<ReaderSession | null | undefined>(undefined);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(initialIntent?.replyTarget ?? null);
  const [likedByUri, setLikedByUri] = useState<Record<string, string | null>>({});
  const [pendingLikeSubject, setPendingLikeSubject] = useState<StrongRef | null>(
    initialIntent?.pendingAction.kind === "like" ? initialIntent.pendingAction.subject : null,
  );
  const [authGate, setAuthGate] = useState<PendingAction | null>(null);
  const draftRef = useRef(initialIntent?.draft ?? "");
  const rehydratedRef = useRef(false);

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

  // Rehydration (point 3): once we know whether an OAuth redirect actually
  // landed us signed in (or not — session resolves to null too), apply
  // what's stashed exactly once and clear it; a page load with nothing
  // stashed is a no-op. The draft/replyTarget are already restored by this
  // point (they seeded the state initializers above — draftRef's initial
  // value and ReplyBox's `initialDraft` prop, and `replyTarget`'s own
  // initializer); this effect's job is the parts that need `session` to have
  // actually resolved: focusing the field for a pending "reply" (deliberately
  // NOT auto-posted — restoring authored content and posting it without a
  // click is too surprising), and scrolling back to the composer either way,
  // so the reader isn't left wondering what just happened after a full page
  // navigation away and back. A pending "like" is applied by PostLikeButton /
  // PendingCommentLikeApplier watching `pendingLikeSubject` directly, not
  // here — this effect only clears the stash and handles focus/scroll.
  useEffect(() => {
    if (session === undefined || rehydratedRef.current || !initialIntent) return;
    rehydratedRef.current = true;
    if (initialIntent.pendingAction.kind === "reply" && session) {
      document.getElementById("hedgerow-reply-field")?.focus();
    }
    // scrollIntoView on the composer element, not a raw `window.scrollTo(0,
    // intent.scrollY)` — more robust across a real navigation-and-reload,
    // where layout above the fold (an ad, a banner, image loading) can
    // easily differ enough that the old pixel offset no longer points at the
    // composer. Fall back to the stashed pixel value only if the element
    // genuinely can't be found (shouldn't happen once ReplyBox has mounted,
    // but cheap insurance).
    const composer = document.querySelector(".hedgerow-reply-box");
    if (composer) composer.scrollIntoView({ block: "center" });
    else window.scrollTo(0, initialIntent.scrollY);
    clearStashedIntent(post);
  }, [session, initialIntent, post]);

  const openAuthGate = useCallback((pendingAction: PendingAction) => setAuthGate(pendingAction), []);
  const consumePendingLike = useCallback(() => setPendingLikeSubject(null), []);

  // The three per-comment interaction entrypoints Comments.LikeButton /
  // Comments.ReplyButton call (via Comments.Root's onLikeComment /
  // onUnlikeComment / onReplyToComment) — see @hedgerow/react's README
  // "Per-comment interactions". react itself never imports @hedgerow/reader;
  // this is where the two meet. Passed UNCONDITIONALLY now (not
  // `session ? handleLikeComment : undefined`) — see the README's "Auth on
  // demand" recipe for why gating the PROP made Comments.ReplyButton render
  // nothing and Comments.LikeButton hard-disable, which is the opposite of
  // interaction-first.
  const handleReplyToComment = useCallback((node: Comment) => {
    // Free — aiming the composer at a specific comment needs no session;
    // only the eventual submit (ReplyBox's handleSubmit) is gated.
    setReplyTarget({ uri: node.uri, cid: node.cid, handle: node.author.handle });
  }, []);

  const handleLikeComment = useCallback(
    async (node: Comment): Promise<void> => {
      if (!session) {
        openAuthGate({ kind: "like", subject: { uri: node.uri, cid: node.cid } });
        // Same rejection-triggers-rollback contract PostLikeButton's onLike
        // uses above — see its comment for why this is deliberate, not a
        // leaked error.
        throw new Error("hedgerow: signed out — opened the auth gate instead of liking");
      }
      const like = await reader.like({ uri: node.uri, cid: node.cid });
      setLikedByUri((prev) => ({ ...prev, [node.uri]: like.uri }));
    },
    [session, openAuthGate],
  );

  const handleUnlikeComment = useCallback(
    async (node: Comment): Promise<void> => {
      // isCommentLiked reports `false` (never `undefined`) while signed out
      // — see below — so Comments.LikeButton only ever offers "like" in that
      // state; this branch is unreachable without a session that already
      // liked something to begin with. Guarded anyway for symmetry with
      // handleLikeComment.
      if (!session) {
        openAuthGate({ kind: "like", subject: { uri: node.uri, cid: node.cid } });
        throw new Error("hedgerow: signed out — opened the auth gate instead of liking");
      }
      setLikedByUri((prev) => {
        const likeUri = prev[node.uri];
        if (likeUri) void reader.unlike(likeUri);
        return { ...prev, [node.uri]: null };
      });
    },
    [session, openAuthGate],
  );

  const isCommentLiked = useCallback(
    (node: Comment) => {
      // `false`, not `undefined`, while signed out — undefined means
      // "unknown, still resolving" to Comments.LikeButton (see
      // useLikeButton), which would hard-disable the toggle. A signed-out
      // reader isn't in an unresolved state: they're confidently not shown as
      // having liked anything, and the button needs to stay clickable so a
      // click can open the auth gate (handleLikeComment above).
      if (!session) return false;
      return node.uri in likedByUri ? likedByUri[node.uri] != null : undefined;
    },
    [session, likedByUri],
  );

  const readerSessionValue = useMemo(
    () => ({ session, setSession, openAuthGate, draftRef, pendingLikeSubject, consumePendingLike }),
    [session, openAuthGate, pendingLikeSubject, consumePendingLike],
  );

  return (
    <section className="hedgerow" aria-label="Comments from Bluesky">
      {/* Faces come from the paginated getLikes fetch; the COUNT deliberately
          does not — getLikes has no grand total (Likes.Count = fetched actors,
          page-capped), so the true number is the root post's likeCount, rendered
          via Comments.Stats inside the thread root below. */}
      <Likes.Root
        className="hedgerow-likes"
        post={post}
        appView={appViewOverride}
        initialData={initialLikes}
        // Astro's static getStaticPaths snapshot (initialLikes) is computed
        // once per dev/build run, not per request — one extra refetch right
        // after mount (built into useLikes now — see @hedgerow/react's
        // README) closes the "reload right after someone else liked it still
        // shows the stale snapshot" gap, replacing the demo's own
        // RevalidateLikesOnMount workaround.
        revalidateOnMount={Boolean(initialLikes)}
      >
        <Likes.Avatars className="hedgerow-avatars" max={6}>
          <Likes.Avatar className="hedgerow-avatar" />
        </Likes.Avatars>
      </Likes.Root>

      <ReaderSessionContext.Provider value={readerSessionValue}>
        <Comments.Root
          className="hedgerow-comments"
          post={post}
          sort="newest"
          maxDepth={6}
          appView={appViewOverride}
          initialData={initialThread}
          revalidateOnMount={Boolean(initialThread)}
          onLikeComment={handleLikeComment}
          onUnlikeComment={handleUnlikeComment}
          onReplyToComment={handleReplyToComment}
          isCommentLiked={isCommentLiked}
        >
          <LikeStatusPrefetch likedByUri={likedByUri} setLikedByUri={setLikedByUri} />
          <PendingCommentLikeApplier setLikedByUri={setLikedByUri} />

          <div className="hedgerow-post-likes">
            <LikeCount />
            <PostLikeButton />
          </div>
          <Comments.Loading className="hedgerow-status">Loading comments…</Comments.Loading>
          <Comments.Error className="hedgerow-status">
            Couldn’t load comments right now.
          </Comments.Error>

          <Comments.Empty className="hedgerow-empty">
            <p>No replies yet.</p>
            <Comments.ReplyLink className="hedgerow-reply">
              Be the first to reply on Bluesky →
            </Comments.ReplyLink>
          </Comments.Empty>

          <div className="hedgerow-toolbar">
            <Comments.Stats
              render={(props, state) => (
                <p {...props}>
                  {state.replyCount} {state.replyCount === 1 ? "reply" : "replies"} on Bluesky
                </p>
              )}
            />
            <Comments.ReplyLink className="hedgerow-reply">Reply on Bluesky →</Comments.ReplyLink>
          </div>

          <Comments.List className="hedgerow-list">
            <Comments.Item
              className="hedgerow-item"
              render={(props, state) => (
                <article
                  {...props}
                  ref={
                    state.index === 0 && state.depth === 0
                      ? mergeRefs(props.ref, measureFirstComment)
                      : props.ref
                  }
                />
              )}
            >
              <Comments.Fallback className="hedgerow-fallback" />

              <div className="hedgerow-head">
                <Comments.Avatar className="hedgerow-item-avatar" />
                <Comments.Author className="hedgerow-author" />
                <Comments.Timestamp
                  className="hedgerow-time"
                  render={(props, state) => <time {...props}>{relativeTime(state.date)}</time>}
                />
                <Comments.Labels className="hedgerow-labels" />
              </div>

              <Comments.Content className="hedgerow-content" />

              <div className="hedgerow-foot">
                <Comments.LikeButton
                  className="hedgerow-item-like"
                  render={(props, state) => <button {...props} aria-label={likeAriaLabel(state.count)} />}
                />
                <Comments.ReplyButton className="hedgerow-item-reply-trigger" />
                <Comments.ReplyLink className="hedgerow-item-reply">Reply on Bluesky</Comments.ReplyLink>
              </div>

              <Comments.Replies className="hedgerow-replies" />
            </Comments.Item>
          </Comments.List>

          <ReplyBox
            replyTarget={replyTarget}
            onCancelReplyTarget={() => setReplyTarget(null)}
            initialDraft={initialIntent?.draft ?? ""}
            draftRef={draftRef}
          />
        </Comments.Root>
      </ReaderSessionContext.Provider>

      {authGate && (
        <AuthGateDialog
          post={post}
          pendingAction={authGate}
          draftRef={draftRef}
          replyTarget={replyTarget}
          onClose={() => setAuthGate(null)}
        />
      )}
    </section>
  );
}
