// A tiny HTTP server that stands in for the Bluesky AppView
// (public.api.bsky.app) against a purely local atproto network. The real
// AppView is a separate indexing service (Postgres/Redis dataplane) that
// TestNetworkNoAppView deliberately doesn't run — this shim gets the same
// three read endpoints the comments island needs, computed on the fly by
// reading app.bsky.feed.post / app.bsky.feed.like records straight off the
// local PDS's repos:
//
//   - app.bsky.feed.getPostThread   (packages/comments/src/thread.ts)
//   - app.bsky.feed.getLikes        (packages/comments/src/likes.ts)
//   - com.atproto.identity.resolveHandle (packages/comments/src/resolve.ts;
//     proxied straight to the PDS, which implements this for its own accounts)
//
// Response shapes mirror packages/comments/test/fixtures/*.json (a real,
// captured AppView response) closely enough that the comments package's
// normalization code (thread.ts / likes.ts) treats them identically to the
// production API — this is what lets the SAME browser bundle that talks to
// the real AppView in production talk to this shim in local E2E tests
// (packages/comments never sees the difference).
import { createServer } from "node:http";
import { listRecords } from "@hedgerow/publish";

const POST_COLLECTION = "app.bsky.feed.post";
const LIKE_COLLECTION = "app.bsky.feed.like";
const THREAD_VIEW_POST = "app.bsky.feed.defs#threadViewPost";
const NOT_FOUND_POST = "app.bsky.feed.defs#notFoundPost";

function parseAtUri(uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/.exec(uri ?? "");
  if (!m) throw new Error(`not an at-uri: ${uri}`);
  return { did: m[1], collection: m[2], rkey: m[3] };
}

async function getRecord(pds, repo, collection, rkey, fetchImpl) {
  const u = new URL(`${pds}/xrpc/com.atproto.repo.getRecord`);
  u.searchParams.set("repo", repo);
  u.searchParams.set("collection", collection);
  u.searchParams.set("rkey", rkey);
  const res = await fetchImpl(u);
  if (!res.ok) return null;
  return res.json();
}

/** All records of `collection` across every known account, tagged with the owning did. */
async function listAcrossAccounts(pds, accounts, collection, fetchImpl) {
  const lists = await Promise.all(
    [...accounts.keys()].map(async (did) => {
      const records = await listRecords(pds, did, collection, fetchImpl);
      return records.map((r) => ({ ...r, did }));
    }),
  );
  return lists.flat();
}

function authorView(did, accounts) {
  const account = accounts.get(did);
  return {
    did,
    handle: account?.handle ?? did,
    ...(account?.displayName ? { displayName: account.displayName } : {}),
    labels: [],
  };
}

function postView(record, accounts, likeCount, replyCount) {
  return {
    uri: record.uri,
    cid: record.cid,
    author: authorView(record.did, accounts),
    record: {
      $type: POST_COLLECTION,
      text: record.value.text ?? "",
      createdAt: record.value.createdAt,
    },
    replyCount,
    repostCount: 0,
    likeCount,
    quoteCount: 0,
    indexedAt: record.value.createdAt,
    labels: [],
  };
}

/** Build a getPostThread response by walking reply.parent.uri backlinks across all known repos. */
async function buildThread(pds, accounts, atUri, depth, fetchImpl) {
  const { did, collection, rkey } = parseAtUri(atUri);
  if (collection !== POST_COLLECTION) {
    return { thread: { $type: NOT_FOUND_POST, uri: atUri, notFound: true } };
  }

  const [rootRecord, allPosts, allLikes] = await Promise.all([
    getRecord(pds, did, collection, rkey, fetchImpl),
    listAcrossAccounts(pds, accounts, POST_COLLECTION, fetchImpl),
    listAcrossAccounts(pds, accounts, LIKE_COLLECTION, fetchImpl),
  ]);
  if (!rootRecord) {
    return { thread: { $type: NOT_FOUND_POST, uri: atUri, notFound: true } };
  }

  const byUri = new Map(allPosts.map((p) => [p.uri, p]));
  byUri.set(atUri, { uri: rootRecord.uri, cid: rootRecord.cid, value: rootRecord.value, did });

  const childrenByParent = new Map();
  for (const post of allPosts) {
    const parentUri = post.value.reply?.parent?.uri;
    if (!parentUri) continue;
    const siblings = childrenByParent.get(parentUri) ?? [];
    siblings.push(post);
    childrenByParent.set(parentUri, siblings);
  }
  const likeCountFor = (uri) => allLikes.filter((l) => l.value.subject?.uri === uri).length;

  function view(record, remaining) {
    const children = childrenByParent.get(record.uri) ?? [];
    const replies = remaining > 0 ? children.map((child) => view(child, remaining - 1)) : [];
    return {
      $type: THREAD_VIEW_POST,
      post: postView(record, accounts, likeCountFor(record.uri), children.length),
      replies,
    };
  }

  return { thread: view(byUri.get(atUri), depth) };
}

/** Build a getLikes response: every app.bsky.feed.like whose subject.uri matches, newest first. */
async function buildLikes(pds, accounts, atUri, limit, cursor, fetchImpl) {
  const allLikes = await listAcrossAccounts(pds, accounts, LIKE_COLLECTION, fetchImpl);
  const matching = allLikes
    .filter((l) => l.value.subject?.uri === atUri)
    .sort((a, b) => (a.value.createdAt < b.value.createdAt ? 1 : -1));

  const start = cursor ? Number(cursor) : 0;
  const page = matching.slice(start, start + limit);
  const nextCursor = start + limit < matching.length ? String(start + limit) : undefined;

  return {
    uri: atUri,
    ...(nextCursor ? { cursor: nextCursor } : {}),
    likes: page.map((l) => ({
      createdAt: l.value.createdAt,
      indexedAt: l.value.createdAt,
      actor: authorView(l.did, accounts),
    })),
  };
}

/**
 * Create the shim. `accounts` is a live `Map<did, {handle, displayName?}>` —
 * mutate it (e.g. after creating a new local test account) and subsequent
 * requests pick up the change immediately; the shim never caches.
 */
export function createAppViewShim({ pdsUrl, accounts, fetchImpl = fetch }) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, "http://shim.local");
    try {
      if (url.pathname === "/xrpc/app.bsky.feed.getPostThread") {
        const uri = url.searchParams.get("uri");
        const depth = Number(url.searchParams.get("depth") ?? 10);
        const body = await buildThread(pdsUrl, accounts, uri, depth, fetchImpl);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
        return;
      }

      if (url.pathname === "/xrpc/app.bsky.feed.getLikes") {
        const uri = url.searchParams.get("uri");
        const limit = Number(url.searchParams.get("limit") ?? 100);
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const body = await buildLikes(pdsUrl, accounts, uri, limit, cursor, fetchImpl);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
        return;
      }

      if (url.pathname === "/xrpc/com.atproto.identity.resolveHandle") {
        // The local PDS already implements this for the accounts it hosts —
        // no need to reimplement handle resolution here.
        const upstream = new URL(`${pdsUrl}/xrpc/com.atproto.identity.resolveHandle`);
        upstream.search = url.search;
        const upstreamRes = await fetchImpl(upstream);
        const text = await upstreamRes.text();
        res
          .writeHead(upstreamRes.status, { "content-type": "application/json" })
          .end(text);
        return;
      }

      res.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({ error: "MethodNotFound", message: `unhandled: ${url.pathname}` }),
      );
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" }).end(
        JSON.stringify({ error: "InternalServerError", message: String(err?.message ?? err) }),
      );
    }
  });

  return {
    server,
    /** Start listening (0 = OS-assigned port) and resolve once bound. */
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          resolve({
            port: addr.port,
            url: `http://127.0.0.1:${addr.port}`,
            close: () => new Promise((res2) => server.close(() => res2())),
          });
        });
      });
    },
  };
}
