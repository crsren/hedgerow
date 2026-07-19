#!/usr/bin/env node
// Capture RAW AppView responses into test/fixtures/ so the test suite is fully
// deterministic and offline. This is the live path (run it by hand to refresh
// fixtures); the vitest suite itself never touches the network.
//
// Usage:
//   node scripts/capture-fixtures.mjs <post-url-or-at-uri>
//   node scripts/capture-fixtures.mjs            # auto-pick a bsky.app post
//
// With no argument it fetches the official @bsky.app account's author feed and
// picks a recent post with several replies and likes, so the fixtures always
// contain a genuinely nested, liked thread.
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPVIEW = "https://public.api.bsky.app";
const POST_COLLECTION = "app.bsky.feed.post";
// did:plc for the official @bsky.app account.
const BSKY_OFFICIAL_DID = "did:plc:z72i7hdynmk6r22z27h6tvur";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

async function xrpc(method, params) {
  const u = new URL(`${APPVIEW}/xrpc/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  const res = await fetch(u);
  if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
  return res.json();
}

function parseRef(input) {
  const at = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/.exec(input);
  if (at) return { authority: at[1], rkey: at[2] };
  const url = /^https?:\/\/(?:[^/]*\.)?bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/.exec(input);
  if (url) return { authority: decodeURIComponent(url[1]), rkey: url[2] };
  throw new Error(`Unrecognized post reference: ${input}`);
}

async function resolveHandle(handle) {
  const { did } = await xrpc("com.atproto.identity.resolveHandle", { handle });
  return did;
}

async function pickPostFromFeed() {
  const feed = await xrpc("app.bsky.feed.getAuthorFeed", {
    actor: BSKY_OFFICIAL_DID,
    limit: 100,
    filter: "posts_no_replies",
  });
  const candidate = feed.feed
    .map((item) => item.post)
    .find((p) => p && (p.replyCount ?? 0) > 3 && (p.likeCount ?? 0) > 3);
  if (!candidate) throw new Error("no post with >3 replies and >3 likes in @bsky.app feed");
  return candidate.uri;
}

async function save(name, data) {
  await mkdir(FIXTURES_DIR, { recursive: true });
  await writeFile(join(FIXTURES_DIR, name), JSON.stringify(data, null, 2) + "\n");
  console.log(`  wrote test/fixtures/${name}`);
}

async function main() {
  const arg = process.argv[2];
  let atUri;
  let handleForResolveFixture;

  if (arg) {
    const { authority, rkey } = parseRef(arg);
    if (authority.startsWith("did:")) {
      atUri = `at://${authority}/${POST_COLLECTION}/${rkey}`;
    } else {
      handleForResolveFixture = authority;
      const did = await resolveHandle(authority);
      atUri = `at://${did}/${POST_COLLECTION}/${rkey}`;
    }
  } else {
    atUri = await pickPostFromFeed();
  }
  console.log(`Capturing fixtures for: ${atUri}`);

  // resolveHandle fixture — use the official handle so it's stable.
  handleForResolveFixture = handleForResolveFixture ?? "bsky.app";
  const resolved = await xrpc("com.atproto.identity.resolveHandle", {
    handle: handleForResolveFixture,
  });
  await save("resolveHandle.json", { _handle: handleForResolveFixture, ...resolved });

  // getPostThread with nested replies.
  const thread = await xrpc("app.bsky.feed.getPostThread", {
    uri: atUri,
    depth: 10,
    parentHeight: 0,
  });
  await save("getPostThread.json", thread);

  // getLikes — capture two pages so the pagination test has real cursor data.
  const likesPage1 = await xrpc("app.bsky.feed.getLikes", { uri: atUri, limit: 5 });
  await save("getLikes.json", likesPage1);
  if (likesPage1.cursor) {
    const likesPage2 = await xrpc("app.bsky.feed.getLikes", {
      uri: atUri,
      limit: 5,
      cursor: likesPage1.cursor,
    });
    await save("getLikes-page2.json", likesPage2);
  }

  console.log("\nDone. Fixture post at-uri:", atUri);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
