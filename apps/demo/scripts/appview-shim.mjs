// A tiny HTTP server that stands in for the Bluesky AppView
// (public.api.bsky.app) against a purely local atproto network. The real
// AppView is a separate indexing service (Postgres/Redis dataplane) that
// TestNetworkNoAppView deliberately doesn't run — this shim gets the same
// three read endpoints the comments island needs, computed on the fly by
// reading app.bsky.feed.post / app.bsky.feed.like records straight off the
// local PDS's repos. Which repos to read is discovered live via
// com.atproto.sync.listRepos (see listAcrossAccounts below), not a fixed seed
// list — so an account created after this shim started (a reader signing up
// mid-session, SLIMS-69) is included too, not just dev-net.mjs's boot-time
// accounts:
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

/**
 * Every DID the PDS currently hosts a repo for, discovered live via
 * com.atproto.sync.listRepos. Paged, though in practice a dev-net PDS never
 * gets remotely close to needing a second page.
 */
async function listRepoDids(pds, fetchImpl) {
  const dids = [];
  let cursor;
  do {
    const u = new URL(`${pds}/xrpc/com.atproto.sync.listRepos`);
    u.searchParams.set("limit", "1000");
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetchImpl(u);
    if (!res.ok) break;
    const body = await res.json();
    for (const r of body.repos ?? []) dids.push(r.did);
    cursor = body.cursor;
  } while (cursor);
  return dids;
}

/** The PDS's own record of a repo's handle — used to backfill `accounts` for a did it didn't already know about. */
async function describeRepo(pds, did, fetchImpl) {
  const u = new URL(`${pds}/xrpc/com.atproto.repo.describeRepo`);
  u.searchParams.set("repo", did);
  const res = await fetchImpl(u);
  if (!res.ok) return null;
  return res.json();
}

/**
 * All records of `collection` across every repo the PDS currently hosts —
 * discovered live via com.atproto.sync.listRepos, NOT the static `accounts`
 * seed map. This is what makes a repo created after this shim started (a
 * reader who signs up mid-session, or any local test account minted post-boot)
 * show up in threads/likes at all: with the old `accounts.keys()`-only
 * iteration, such a repo's posts/likes were invisible no matter how it
 * replied — createRecord would succeed, but getPostThread would never walk to
 * it. `accounts` is still consulted for handle/displayName first (cheap, no
 * extra round trip); a did missing from it gets a live describeRepo lookup,
 * cached back into the map so repeat requests don't re-fetch it.
 */
async function listAcrossAccounts(pds, accounts, collection, fetchImpl) {
  const dids = await listRepoDids(pds, fetchImpl);
  const lists = await Promise.all(
    dids.map(async (did) => {
      if (!accounts.has(did)) {
        const info = await describeRepo(pds, did, fetchImpl);
        accounts.set(did, { handle: info?.handle ?? did });
      }
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
 * requests pick up the change immediately. It's a name/displayName cache, not
 * the source of truth for WHICH repos exist, though: `listAcrossAccounts`
 * discovers those live via com.atproto.sync.listRepos and backfills this map
 * for any did it doesn't already have, so a repo never needs to be seeded
 * into `accounts` up front to be visible.
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
