import { Comments } from "@hedgerow/react";
import "./comment-thread.css";

export default function CommentThread({ post }: { post: string }) {
  return (
    <Comments.Root className="hedgerow-comments" post={post} sort="oldest">
      <header>
        <h2>Conversation</h2>
        <Comments.Stats className="hedgerow-comment-stats">
          <Comments.ReplyLink>Reply on Bluesky</Comments.ReplyLink>
        </Comments.Stats>
      </header>
      <Comments.Loading>Loading replies…</Comments.Loading>
      <Comments.Error>Replies could not be loaded.</Comments.Error>
      <Comments.Empty>No replies yet.</Comments.Empty>
      <Comments.List className="hedgerow-comment-list">
        <Comments.Item className="hedgerow-comment">
          <Comments.Fallback className="hedgerow-comment-fallback" />
          <div className="hedgerow-comment-head">
            <Comments.Avatar className="hedgerow-comment-avatar" />
            <Comments.Author className="hedgerow-comment-author" />
            <Comments.Timestamp className="hedgerow-comment-time" />
          </div>
          <Comments.Content className="hedgerow-comment-body" />
          <div className="hedgerow-comment-foot">
            <Comments.LikeCount />
            <Comments.ReplyLink>Reply</Comments.ReplyLink>
          </div>
          <Comments.Replies className="hedgerow-comment-replies" />
        </Comments.Item>
      </Comments.List>
    </Comments.Root>
  );
}
