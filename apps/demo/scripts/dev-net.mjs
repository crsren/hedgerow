#!/usr/bin/env node
// A fully local atproto network for testing the demo's whole UX — publish,
// site render, comments — with NO Docker, NO real accounts, NO live network.
//
//   node scripts/dev-net.mjs
//
// Boots an in-process PLC + PDS (@atproto/dev-env's TestNetworkNoAppView —
// see packages/publish/test/roundtrip.test.ts for the same primitive), then:
//
//   1. Creates two local-only test accounts: alice.test (the site owner) and
//      bob.test (a commenter).
//   2. Publishes the ACTUAL posts in apps/demo/posts/ through the real
//      @hedgerow/publish package (agentPublisher over a plain AtpAgent
//      session on the local PDS) — the same code path apps/demo/scripts/
//      publish.mjs uses against a real PDS.
//   3. Seeds a couple of bob.test replies + a like onto the first document's
//      comment anchor, so the comments UI has real content.
//   4. Starts the AppView shim (./appview-shim.mjs) that serves
//      getPostThread/getLikes/resolveHandle off those local records — the
//      local network has no separate AppView/dataplane to ask.
//
// Prints the env vars that point the demo app's live mode (HEDGEROW_HANDLE —
// see apps/demo/src/lib/site.ts) at this network, then keeps running until
// Ctrl-C. `apps/demo/e2e/serve.mjs` imports `startDevNet` directly to drive
// this same network under Playwright.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AtpAgent } from "@atproto/api";
import { TestNetworkNoAppView } from "@atproto/dev-env";
import { agentPublisher, emptyState, parsePost, publishSite } from "@hedgerow/publish";
import { createAppViewShim } from "./appview-shim.mjs";

const POSTS_DIR = fileURLToPath(new URL("../posts", import.meta.url));

const PUBLICATION_CONFIG = {
  url: "https://demo.hedgerow.local",
  name: "Hedgerow Demo (local)",
  description: "The Hedgerow demo, rendered from records on a fully local atproto network.",
};

const SEED_PASSWORD = "hunter2hunter2"; // local-only dev-net account, never a real credential
const SEED_REPLIES = [
  "Nice piece — this is exactly why I moved my own writing to a repo I control.",
  "The record-vs-page framing finally clicked for me here.",
];

/**
 * Boot the local network, publish the demo posts, seed a thread, start the
 * shim. Returns everything needed to point a client at it, plus `close()`.
 */
export async function startDevNet({ log = console.log } = {}) {
  log("Booting local atproto network (in-process PLC + PDS, no Docker)…");
  const net = await TestNetworkNoAppView.create();
  const pdsUrl = net.pds.url;
  const plcUrl = net.plc.url;
  log(`  PLC ${plcUrl}`);
  log(`  PDS ${pdsUrl}`);

  const alice = new AtpAgent({ service: pdsUrl });
  const aliceAccount = await alice.createAccount({
    handle: "alice.test",
    email: "alice@dev-net.local",
    password: SEED_PASSWORD,
  });
  const bob = new AtpAgent({ service: pdsUrl });
  const bobAccount = await bob.createAccount({
    handle: "bob.test",
    email: "bob@dev-net.local",
    password: SEED_PASSWORD,
  });

  const accounts = new Map([
    [aliceAccount.data.did, { handle: "alice.test", displayName: "Alice" }],
    [bobAccount.data.did, { handle: "bob.test", displayName: "Bob" }],
  ]);
  log(`  alice.test -> ${aliceAccount.data.did}`);
  log(`  bob.test   -> ${bobAccount.data.did}`);

  // Publish the ACTUAL demo posts through the real publish package. Strip any
  // frontmatter bskyPostUri/bskyPostRef first: those (see apps/demo/posts/)
  // point at real bsky.app posts that don't exist on this local network and
  // would just surface as "could not resolve" warnings. `share: true` then
  // mints a fresh local app.bsky.feed.post per document instead, so every doc
  // gets a genuine comment anchor that actually lives on this network.
  const posts = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const post = parsePost(readFileSync(join(POSTS_DIR, f), "utf8"), f.replace(/\.md$/, ""));
      delete post.bskyPostUri;
      delete post.bskyPostRef;
      return post;
    });

  const publisher = agentPublisher(alice);
  const result = await publishSite(publisher, PUBLICATION_CONFIG, posts, emptyState(), {
    share: { enabled: true },
  });
  for (const w of result.warnings) log(`  publish warning: ${w}`);
  log(`  published ${result.documents.length} document(s) — publication ${result.publicationUri}`);

  // Seed bob.test replies + a like onto the first document's share post.
  const seeded = result.documents[0];
  const anchor = seeded && result.state.shares[seeded.slug];
  if (seeded && anchor) {
    await seedThread(bob, anchor);
    log(`  seeded ${SEED_REPLIES.length} repl${SEED_REPLIES.length === 1 ? "y" : "ies"} + 1 like on "${seeded.title}"`);
  } else {
    log("  no document to seed a thread on (posts/ is empty?)");
  }

  const shim = createAppViewShim({ pdsUrl, accounts });
  const shimServer = await shim.listen(0);
  log(`  AppView shim  ${shimServer.url}`);

  // Env vars that point apps/demo/src/lib/site.ts's live mode at this
  // network. HEDGEROW_APPVIEW_URL isn't read by site.ts (comments fetch
  // client-side); it's exposed here for whatever wires the comments island to
  // the shim (see apps/demo/e2e/read-path.spec.ts for the Playwright route).
  const env = {
    HEDGEROW_HANDLE: "alice.test",
    HEDGEROW_PDS_URL: pdsUrl,
    HEDGEROW_PLC_URL: plcUrl,
    HEDGEROW_RESOLVE_HANDLE_SERVICE: pdsUrl,
    HEDGEROW_APPVIEW_URL: shimServer.url,
  };

  return {
    net,
    pdsUrl,
    plcUrl,
    accounts,
    publishResult: result,
    seeded: seeded ? { slug: seeded.slug, title: seeded.title, anchor } : null,
    shim: shimServer,
    env,
    async close() {
      await shimServer.close();
      await net.close();
    },
  };
}

/** bob replies twice (nested) and likes the anchor post. */
async function seedThread(bobAgent, anchor) {
  const reply1 = await bobAgent.com.atproto.repo.createRecord({
    repo: bobAgent.did,
    collection: "app.bsky.feed.post",
    record: {
      $type: "app.bsky.feed.post",
      text: SEED_REPLIES[0],
      createdAt: new Date().toISOString(),
      reply: { root: anchor, parent: anchor },
    },
  });
  await bobAgent.com.atproto.repo.createRecord({
    repo: bobAgent.did,
    collection: "app.bsky.feed.post",
    record: {
      $type: "app.bsky.feed.post",
      text: SEED_REPLIES[1],
      createdAt: new Date().toISOString(),
      reply: { root: anchor, parent: { uri: reply1.data.uri, cid: reply1.data.cid } },
    },
  });
  await bobAgent.com.atproto.repo.createRecord({
    repo: bobAgent.did,
    collection: "app.bsky.feed.like",
    record: { $type: "app.bsky.feed.like", subject: anchor, createdAt: new Date().toISOString() },
  });
}

// CLI entrypoint — only runs when invoked directly (`node scripts/dev-net.mjs`),
// not when imported (e.g. by apps/demo/e2e/serve.mjs).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dn = await startDevNet().catch((err) => {
    console.error(err);
    process.exit(1);
  });

  console.log("\nLocal atproto network is up. Point the demo's live mode at it with:\n");
  for (const [k, v] of Object.entries(dn.env)) console.log(`  export ${k}=${v}`);
  console.log(
    "\nThen, in another terminal:\n\n  pnpm --filter @hedgerow/demo dev\n\n(and open http://localhost:4321)",
  );
  console.log("\nPress Ctrl-C to stop.\n");

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down…");
    await dn.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
