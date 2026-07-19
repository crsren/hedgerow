// The SLIMS-54 dogfood island. A client-hydrated comment thread + like count
// rendered entirely with the headless @hedgerow/react parts — this file doubles
// as the reference for how a consumer styles them (className + data-* selectors,
// render props for custom markup). All styling lives in comment-thread.css; the
// article above stays fully static.
import { useCallback, useRef } from "react";
import { Comments, Likes, mergeRefs, useCommentsContext } from "@hedgerow/react";
import "./comment-thread.css";

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
      <Likes.Root className="hedgerow-likes" post={post}>
        <Likes.Avatars className="hedgerow-avatars" max={6}>
          <Likes.Avatar className="hedgerow-avatar" />
        </Likes.Avatars>
      </Likes.Root>

      <Comments.Root className="hedgerow-comments" post={post} sort="newest" maxDepth={6}>
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
      </Comments.Root>
    </section>
  );
}
