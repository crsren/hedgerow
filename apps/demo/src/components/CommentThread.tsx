// The SLIMS-54 dogfood island, extended by SLIMS-66 (reply-in-place) and
// SLIMS-69 (in-place likes + full comment interactions: liking the post,
// liking/replying to individual comments with a single retargeting composer,
// optimistic reply rendering, and an SSR thread snapshot). A client-hydrated
// comment thread + like count + reply box, all rendered with the headless
// @hedgerow/react parts — this file doubles as the reference for how a
// consumer styles them (className + data-* selectors, render props for
// custom markup) AND for how to wire @hedgerow/reader's browser OAuth reader
// identity into Comments.*/Likes.*/Reply.* (react has no dependency on reader
// itself — see docs/architecture.md). All styling lives in
// comment-thread.css; the article above stays fully static.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Comments,
  Likes,
  Reply,
  mergeRefs,
  useCommentsContext,
  useLikesContext,
  type Comment,
  type CommentAction,
  type LikesResult,
  type ThreadResult,
} from "@hedgerow/react";
import { createReader, type ReaderSession, type StrongRef } from "@hedgerow/reader";
import "./comment-thread.css";

// Local/test-network overrides, read from Astro's client-exposed env vars
// (Vite only exposes PUBLIC_-prefixed vars to browser code via
// import.meta.env — see apps/demo/scripts/dev-net.mjs, which sets these when
// pointing the demo at a fully local atproto network, and
// docs/local-testing.md). All four are undefined in production, in which
// case createReader()/appView fall back to their normal defaults (the public
// Bluesky AppView, a hosted/loopback OAuth client) — this override path never
// changes production behavior.
const appViewOverride = import.meta.env.PUBLIC_HEDGEROW_APPVIEW_URL as string | undefined;
const handleResolverOverride = import.meta.env.PUBLIC_HEDGEROW_HANDLE_RESOLVER as string | undefined;
const plcDirectoryUrlOverride = import.meta.env.PUBLIC_HEDGEROW_PLC_URL as string | undefined;
const allowHttpOverride = import.meta.env.PUBLIC_HEDGEROW_OAUTH_ALLOW_HTTP === "1";
const signupServiceOverride = import.meta.env.PUBLIC_HEDGEROW_SIGNUP_SERVICE as string | undefined;

// One reader identity per page load. Cheap to construct — createReader() does
// no OAuth-client/IndexedDB work until the first actual call (see the package
// README) — so a module-level singleton is fine even though this module is
// also evaluated during Astro's SSR pass for the initial HTML.
const reader = createReader({
  ...(handleResolverOverride ? { handleResolver: handleResolverOverride } : {}),
  ...(plcDirectoryUrlOverride ? { plcDirectoryUrl: plcDirectoryUrlOverride } : {}),
  ...(allowHttpOverride ? { allowHttp: true } : {}),
});

// Shared across ReplyBox / PostLikeButton / LikeStatusPrefetch, all mounted
// as siblings deep inside <Comments.Root> — a tiny demo-local context beats
// threading `session`/`setSession` through every intermediate template layer.
// `session`: undefined = still resuming; null = signed out; object = signed in.
interface ReaderSessionContextValue {
  session: ReaderSession | null | undefined;
  setSession: (session: ReaderSession | null) => void;
}
const ReaderSessionContext = createContext<ReaderSessionContextValue>({
  session: undefined,
  setSession: () => {},
});
const useReaderSession = () => useContext(ReaderSessionContext);

/** Where the reply composer is currently aimed — null means the root post. */
interface ReplyTarget {
  uri: string;
  cid: string;
  handle: string;
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
 * The "like the post" toggle (SLIMS-69), next to LikeCount. Reads the
 * reader's own like state via findLike on mount (no authenticated AppView to
 * ask directly — see @hedgerow/reader's README), then wires Likes.Button's
 * injected liked/onLike/onUnlike straight to reader.like()/unlike().
 */
function PostLikeButton() {
  const { data, root, stats, refetch } = useCommentsContext();
  const { session } = useReaderSession();
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

  if (!data || !root || root.type !== "comment") return null;
  const subject: StrongRef = { uri: data.uri, cid: root.cid };

  // undefined while the findLike lookup is still resolving (Likes.Button
  // treats "unknown" and "not liked" very differently — the toggle stays
  // disabled for the former).
  const liked = session && likeUri !== undefined ? likeUri !== null : undefined;

  return (
    <Likes.Button
      className="hedgerow-like-button"
      liked={liked}
      count={stats?.likeCount ?? 0}
      disabled={!session}
      // Likes.Button's own optimistic overlay gives instant feedback on the
      // button itself; refetch() afterwards is what brings the *other*
      // count on the page — LikeCount's "N likes" text, driven by
      // stats.likeCount — into agreement with it. The local AppView shim
      // recomputes likeCount live off the PDS on every request (no indexing
      // lag), so in practice this converges immediately; a real deployment
      // could take a moment to index, same as any other engagement count.
      onLike={() => reader.like(subject).then((ref) => setLikeUri(ref.uri)).then(refetch)}
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
 * `onCommentAction`/`isCommentLiked` — which `Comments.Root` itself needs —
 * can read it too.
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
 * The client-side half of "render immediately from snapshot, then revalidate
 * on mount" (SLIMS-69's SSR thread snapshot). `useComments`'s `initialData`
 * seed deliberately skips only the very first FETCH on mount (see its own
 * tests/docs) — it never re-fetches on its own afterwards. That's fine when
 * the snapshot is fresh, but Astro's static `getStaticPaths` output (where
 * `[...slug].astro` fetches `initialThread`) is computed once per dev/build
 * run, not per request — verified by hand: liking a post updates the live
 * thread immediately client-side, but a bare page reload right after showed
 * the STALE pre-like count until this component was added. One refetch()
 * right after mount closes that gap without touching useComments' own
 * (tested, relied-upon) skip-the-first-fetch contract.
 */
function RevalidateCommentsOnMount({ hadSnapshot }: { hadSnapshot: boolean }) {
  const { refetch } = useCommentsContext();
  useEffect(() => {
    if (hadSnapshot) refetch();
    // Deliberately once, right after mount — not on every refetch identity
    // change (post/maxDepth churn already re-triggers useComments' own effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Likes.Root's counterpart to RevalidateCommentsOnMount, same reasoning. */
function RevalidateLikesOnMount({ hadSnapshot }: { hadSnapshot: boolean }) {
  const { refetch } = useLikesContext();
  useEffect(() => {
    if (hadSnapshot) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
 * The reply-in-place composer (SLIMS-66), extended by SLIMS-69 to retarget:
 * one composer instance, aimed at either the root post (default) or a
 * specific comment via `replyTarget` — set by `Comments.ReplyButton`'s
 * `onCommentAction("reply", node)` below, cleared by the "Cancel" affordance
 * or a successful submit.
 */
function ReplyBox({
  replyTarget,
  onCancelReplyTarget,
}: {
  replyTarget: ReplyTarget | null;
  onCancelReplyTarget: () => void;
}) {
  const { data, root, addOptimisticReply, refetch } = useCommentsContext();
  const { session, setSession } = useReaderSession();
  const [handleInput, setHandleInput] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Give the AppView/shim a few seconds to index a just-posted reply,
  // confirming/unconfirming useComments' own optimistic entry as each
  // refetch lands (see @hedgerow/react's README "Optimistic replies"). Not
  // awaited by handleSubmit — the reply is already visible the instant that
  // returns (via addOptimisticReply), so there's no reason to keep the
  // composer in a submitting state for these extra seconds.
  const retryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => retryTimers.current.forEach(clearTimeout), []);
  const scheduleConfirmRetries = useCallback(() => {
    for (const delayMs of [2000, 4000, 6000]) {
      retryTimers.current.push(setTimeout(refetch, delayMs));
    }
  }, [refetch]);

  // No strongRef to reply against yet (still loading, or the root itself is a
  // deleted/blocked stub) — nothing sensible to render.
  if (!data || !root || root.type !== "comment") return null;
  const rootRef: StrongRef = { uri: data.uri, cid: root.cid };
  const parentRef: StrongRef = replyTarget ?? rootRef;

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
    const ref = await reader.createReply({ root: rootRef, parent: parentRef, text });
    addOptimisticReply({
      ref,
      parentUri: parentRef.uri,
      text,
      author: {
        did: session!.did,
        handle: session!.handle,
        ...(session!.displayName ? { displayName: session!.displayName } : {}),
      },
    });
    onCancelReplyTarget(); // back to replying-to-root once this send is in flight
    scheduleConfirmRetries();
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
      </Reply.SignedIn>
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

  const [session, setSession] = useState<ReaderSession | null | undefined>(undefined);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [likedByUri, setLikedByUri] = useState<Record<string, string | null>>({});

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

  // The single per-comment interaction entrypoint Comments.LikeButton /
  // Comments.ReplyButton call (via Comments.Root's onCommentAction) — see
  // @hedgerow/react's README "Per-comment interactions". react itself never
  // imports @hedgerow/reader; this is where the two meet.
  const handleCommentAction = useCallback(async (action: CommentAction, node: Comment) => {
    if (action === "reply") {
      setReplyTarget({ uri: node.uri, cid: node.cid, handle: node.author.handle });
      return;
    }
    if (action === "like") {
      const like = await reader.like({ uri: node.uri, cid: node.cid });
      setLikedByUri((prev) => ({ ...prev, [node.uri]: like.uri }));
      return;
    }
    // action === "unlike"
    setLikedByUri((prev) => {
      const likeUri = prev[node.uri];
      if (likeUri) void reader.unlike(likeUri);
      return { ...prev, [node.uri]: null };
    });
  }, []);

  const isCommentLiked = useCallback(
    (node: Comment) => (node.uri in likedByUri ? likedByUri[node.uri] != null : undefined),
    [likedByUri],
  );

  const readerSessionValue = useMemo(() => ({ session, setSession }), [session]);

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
      >
        <RevalidateLikesOnMount hadSnapshot={Boolean(initialLikes)} />
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
          onCommentAction={session ? handleCommentAction : undefined}
          isCommentLiked={session ? isCommentLiked : undefined}
        >
          <RevalidateCommentsOnMount hadSnapshot={Boolean(initialThread)} />
          <LikeStatusPrefetch likedByUri={likedByUri} setLikedByUri={setLikedByUri} />

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
                <Comments.LikeButton className="hedgerow-item-like" />
                <Comments.ReplyButton className="hedgerow-item-reply-trigger" />
                <Comments.ReplyLink className="hedgerow-item-reply">Reply on Bluesky</Comments.ReplyLink>
              </div>

              <Comments.Replies className="hedgerow-replies" />
            </Comments.Item>
          </Comments.List>

          <ReplyBox replyTarget={replyTarget} onCancelReplyTarget={() => setReplyTarget(null)} />
        </Comments.Root>
      </ReaderSessionContext.Provider>
    </section>
  );
}
