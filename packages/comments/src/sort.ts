// Pure reply-ordering helpers. Renderers pick the order; the core never sorts
// implicitly. Sorting recurses into nested replies so the whole visible tree is
// ordered consistently. notFound/blocked stubs have no timestamp or count, so
// they sort to the end while keeping their relative order stable.
import type { CommentNode } from "./types.js";

export type SortOrder = "newest" | "oldest" | "most-liked";

function sortKey(node: CommentNode): { time: number; likes: number; stub: boolean } {
  if (node.type !== "comment") return { time: 0, likes: 0, stub: true };
  const t = Date.parse(node.createdAt);
  return { time: Number.isNaN(t) ? 0 : t, likes: node.likeCount, stub: false };
}

function compare(a: CommentNode, b: CommentNode, order: SortOrder): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  // Stubs always trail real comments regardless of order.
  if (ka.stub !== kb.stub) return ka.stub ? 1 : -1;
  switch (order) {
    case "newest":
      return kb.time - ka.time;
    case "oldest":
      return ka.time - kb.time;
    case "most-liked":
      // Ties broken by recency so the order is deterministic.
      return kb.likes - ka.likes || kb.time - ka.time;
  }
}

/**
 * Return a new array of the given reply nodes ordered by `order`, with each
 * comment's own `replies` recursively sorted the same way. Input is not mutated.
 */
export function sortReplies(nodes: CommentNode[], order: SortOrder): CommentNode[] {
  return nodes
    .map((n) =>
      n.type === "comment" ? { ...n, replies: sortReplies(n.replies, order) } : n,
    )
    .sort((a, b) => compare(a, b, order));
}
