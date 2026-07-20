// The SLIMS-54 dogfood island, extended by SLIMS-66 with a reply-in-place
// composer. A client-hydrated comment thread + like count + reply box, all
// rendered with the headless @hedgerow/react parts — this file doubles as the
// reference for how a consumer styles them (className + data-* selectors,
// render props for custom markup) AND for how to wire @hedgerow/reader's
// browser OAuth reader identity into `Reply.*` (react has no dependency on
// reader itself — see docs/architecture.md). All styling lives in
// comment-thread.css; the article above stays fully static.
import { useCallback, useEffect, useRef, useState } from "react";
import { Comments, Likes, Reply, mergeRefs, useCommentsContext, type CommentNode } from "@hedgerow/react";
import type { ReaderSession } from "@hedgerow/reader";
import { appViewOverride, reader, signupServiceOverride } from "../lib/reader";
import "./comment-thread.css";

/** Depth-first search for a reply's uri in the (already sorted/filtered) tree. */
function containsReply(nodes: readonly CommentNode[], uri: string): boolean {
  for (const node of nodes) {
    if (node.uri === uri) return true;
    if (node.type === "comment" && containsReply(node.replies, uri)) return true;
  }
  return false;
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

/**
 * The reply-in-place composer, reading the thread's own root strongRef
 * (uri + cid — both already on `ThreadResult`/`Comment`, no changes needed to
 * @hedgerow/comments) so a top-level reply targets the right post. v1 only
 * replies to the root post, so `root` and `parent` are the same strongRef.
 */
function ReplyBox() {
  const { data, root, comments, refetch } = useCommentsContext();

  // undefined = still resuming a session; null = signed out; object = signed in.
  const [session, setSession] = useState<ReaderSession | null | undefined>(undefined);
  const [handleInput, setHandleInput] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // AppView indexing lag: after a successful post, poll for the reply to show
  // up in the thread — up to 3 retries, 2s apart (~6s) — then give up quietly.
  const [pendingReplyUri, setPendingReplyUri] = useState<string | null>(null);
  const [indexingDelayed, setIndexingDelayed] = useState(false);
  const retryCount = useRef(0);

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

  useEffect(() => {
    if (!pendingReplyUri) return;
    if (containsReply(comments, pendingReplyUri)) {
      setPendingReplyUri(null);
      setIndexingDelayed(false);
      retryCount.current = 0;
      return;
    }
    if (retryCount.current >= 3) {
      setIndexingDelayed(true);
      return;
    }
    retryCount.current += 1;
    const timer = setTimeout(refetch, 2000);
    return () => clearTimeout(timer);
  }, [pendingReplyUri, comments, refetch]);

  // No strongRef to reply against yet (still loading, or the root itself is a
  // deleted/blocked stub) — nothing sensible to render.
  if (!data || !root || root.type !== "comment") return null;
  const rootRef = { uri: data.uri, cid: root.cid };

  async function handleSignIn() {
    const handle = handleInput.trim();
    if (!handle || signingIn) return;
    setSigningIn(true);
    setAuthError(null);
    try {
      await reader.signIn(handle); // redirects; only returns on failure/abort
    } catch (err) {
      // Surface it — a swallowed OAuth setup error (bad handle, misconfigured
      // client, non-loopback dev origin) otherwise looks like a dead button.
      setAuthError(err instanceof Error ? err.message : "Could not start login.");
      setSigningIn(false);
    }
  }

  async function handleSignUp() {
    if (signingUp) return;
    setSigningUp(true);
    setAuthError(null);
    try {
      // prompt: "create" — the reader signs up on the authorization server
      // mid-flow and lands back here already authorized; no separate login
      // step after. The service defaults to bsky.social; local dev-net mode
      // overrides it so the fully-local sandbox never reaches the live network.
      await reader.signUp(signupServiceOverride); // redirects; only returns on failure/abort
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not start signup.");
      setSigningUp(false);
    }
  }

  async function handleSubmit(text: string) {
    const reply = await reader.createReply({ root: rootRef, parent: rootRef, text });
    retryCount.current = 0;
    setIndexingDelayed(false);
    setPendingReplyUri(reply.uri);
  }

  if (session === undefined) return null; // avoid a signed-out flash while resuming

  return (
    <Reply.Root className="hedgerow-reply-box" session={session} onSubmit={handleSubmit}>
      <Reply.SignedOut className="hedgerow-reply-signedout">
        {/* A plain <div>, not <form> — Reply.Root already renders a <form>
            (for the reply composer's Enter-to-submit), and nesting a second
            <form> inside it is invalid HTML: browsers make the outer form
            "win" the submit, so the inner one's onSubmit never fires. Enter
            here is handled explicitly via onKeyDown instead. */}
        <div className="hedgerow-reply-login">
          <input
            type="text"
            id="hedgerow-reply-handle"
            name="handle"
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
        <p className="hedgerow-reply-signup">
          New here?{" "}
          <button
            type="button"
            className="hedgerow-reply-signup-button"
            onClick={handleSignUp}
            disabled={signingUp}
          >
            {signingUp ? "Redirecting…" : "Sign up with Bluesky"}
          </button>{" "}
          — you'll approve access on your Bluesky server and land right back here.{" "}
          <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">
            (or create an account on bsky.app)
          </a>
        </p>
        {authError && (
          <p className="hedgerow-reply-error" role="alert">
            {authError}
          </p>
        )}
      </Reply.SignedOut>

      <Reply.SignedIn className="hedgerow-reply-signedin">
        <div className="hedgerow-reply-identity">
          <span>
            Replying as <strong>{session?.displayName || session?.handle}</strong>
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
        {indexingDelayed && (
          <p className="hedgerow-reply-delayed">
            Your reply is on its way — it can take a few seconds to show up here.
          </p>
        )}
      </Reply.SignedIn>
    </Reply.Root>
  );
}

export default function CommentThread({ post }: { post: string }) {
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

  return (
    <section className="hedgerow" aria-label="Comments from Bluesky">
      {/* Faces come from the paginated getLikes fetch; the COUNT deliberately
          does not — getLikes has no grand total (Likes.Count = fetched actors,
          page-capped), so the true number is the root post's likeCount, rendered
          via Comments.Stats inside the thread root below. */}
      <Likes.Root className="hedgerow-likes" post={post} appView={appViewOverride}>
        <Likes.Avatars className="hedgerow-avatars" max={6}>
          <Likes.Avatar className="hedgerow-avatar" />
        </Likes.Avatars>
      </Likes.Root>

      <Comments.Root
        className="hedgerow-comments"
        post={post}
        sort="newest"
        maxDepth={6}
        appView={appViewOverride}
      >
        <LikeCount />
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
              <Comments.Likes
                className="hedgerow-item-likes"
                render={(props, state) => <span {...props}>♥ {state.count}</span>}
              />
              <Comments.ReplyLink className="hedgerow-item-reply">Reply</Comments.ReplyLink>
            </div>

            <Comments.Replies className="hedgerow-replies" />
          </Comments.Item>
        </Comments.List>

        <ReplyBox />
      </Comments.Root>
    </section>
  );
}
