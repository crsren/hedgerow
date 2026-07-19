// Small convenience accessors layered on the context hooks.
import type { CommentNode } from "@hedgerow/comments";
import { useCommentItemContext } from "./context";

/**
 * The current comment node inside a `<Comments.Item>` — the escape hatch for
 * custom parts (read labels, counts, author, replies directly).
 */
export function useCommentNode(): CommentNode {
  return useCommentItemContext().node;
}
