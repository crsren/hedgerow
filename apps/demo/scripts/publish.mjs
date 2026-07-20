// Publish the demo's local posts as site.standard records to a real PDS.
//
//   pnpm --filter @hedgerow/demo run publish:pds
//
// Auth is atproto OAuth: the first run opens a browser for you to log in, then
// caches the session (in ~/.config/hedgerow) and reuses it silently after that.
// There's no password to set — ATP_IDENTIFIER is an optional hint for which
// account to log in as (a handle or DID); omit it to choose in the browser.
//
//   ATP_IDENTIFIER=you.bsky.social pnpm --filter @hedgerow/demo run publish:pds
//
// Flags:
//   --share           auto-create a canonical Bluesky share post for any post
//                     lacking a comment anchor, and use it as the bskyPostRef.
//                     Creates REAL public posts from your account — previews
//                     them and asks for confirmation first (--yes to skip).
//   --prune           delete document records for slugs no longer in ./posts.
//   --print-auth-url  on a fresh login, print the authorization URL instead of
//                     opening a browser (open it yourself; the callback is still
//                     caught on 127.0.0.1). Handy over SSH / for a quick smoke.
//
// State (slug -> record rkey) persists to .publish-state.json so reruns target
// the same records; unchanged posts are skipped (the `changed` flag).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
// SLIMS-64: @hedgerow/publish's top-level "." export is now the isomorphic
// core only (safe for a browser bundle, e.g. the demo's /edit island); this
// script is a Node CLI, so it imports oauthPublisher/openInBrowser (Node-only:
// node:http/child_process) via the "./node" subpath instead — see
// packages/publish/src/node.ts and docs/architecture.md.
import {
  parsePost,
  publishSite,
  oauthPublisher,
  openInBrowser,
  emptyState,
} from "@hedgerow/publish/node";

const POSTS_DIR = fileURLToPath(new URL("../posts", import.meta.url));
const STATE_PATH = fileURLToPath(new URL("../.publish-state.json", import.meta.url));

const config = {
  url: "https://demo.hedgerow.local",
  name: "Hedgerow Demo",
  description:
    "A personal site rendered entirely from site.standard atproto records.",
};

const pdslsLink = (uri) => `https://pdsls.dev/${uri}`;

// at://<did>/app.bsky.feed.post/<rkey> -> the public bsky.app permalink.
const bskyPostLink = (did, uri) => `https://bsky.app/profile/${did}/post/${uri.split("/").pop()}`;

function loadState() {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, "utf8"));
    } catch {
      console.warn("Could not parse .publish-state.json; starting fresh.");
    }
  }
  return emptyState();
}

async function main() {
  const { ATP_IDENTIFIER } = process.env;

  const share = process.argv.includes("--share");
  const prune = process.argv.includes("--prune");
  const printAuthUrl = process.argv.includes("--print-auth-url");

  const posts = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parsePost(readFileSync(join(POSTS_DIR, f), "utf8"), f.replace(/\.md$/, "")));

  // `openUrl` fires only on a fresh login (never when a cached session is
  // restored), so this both messages the user and, with --print-auth-url,
  // swaps the browser open for a printed URL.
  const publisher = await oauthPublisher({
    identifier: ATP_IDENTIFIER,
    openUrl: async (url) => {
      const who = ATP_IDENTIFIER ? ` as ${ATP_IDENTIFIER}` : "";
      if (printAuthUrl) {
        console.log(`No cached session. Open this URL to log in${who}:\n\n${url}\n`);
        console.log("Waiting for the browser redirect… (Ctrl-C to abort)\n");
        return;
      }
      console.log(`No cached session — opening browser to log in${who}…\n`);
      openInBrowser(url);
    },
  });

  console.log(`Publishing ${posts.length} post(s) as ${publisher.did}…\n`);

  const state = loadState();

  // --share creates REAL, publicly visible Bluesky posts from the logged-in
  // account. Show exactly what would be posted and require explicit consent
  // (or --yes) before doing it — records are quiet data, feed posts are not.
  if (share) {
    // Mirror publishSite's mint condition: drafts are skipped entirely, and
    // `share: false` opts a post out of auto-share, so neither would be posted.
    const wouldShare = posts.filter(
      (p) =>
        !p.draft &&
        p.share !== false &&
        !p.bskyPostRef &&
        !p.bskyPostUri &&
        !state.shares?.[p.slug],
    );
    if (wouldShare.length > 0) {
      console.log(`--share will create ${wouldShare.length} PUBLIC Bluesky post(s) from ${publisher.did}:\n`);
      for (const p of wouldShare) {
        const url = `${config.url.replace(/\/+$/, "")}/${p.slug}`;
        console.log(`  ─────`);
        console.log(`  ${p.title}\n\n  ${url}\n`);
      }
      if (!process.argv.includes("--yes")) {
        const { createInterface } = await import("node:readline/promises");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question("Post these to Bluesky? [y/N] ")).trim().toLowerCase();
        rl.close();
        if (answer !== "y" && answer !== "yes") {
          console.log("Aborted — nothing was published (rerun without --share to publish records only).");
          process.exit(0);
        }
      }
    }
  }

  const result = await publishSite(publisher, config, posts, state, {
    ...(share ? { share: { enabled: true } } : {}),
    prune,
  });
  writeFileSync(STATE_PATH, JSON.stringify(result.state, null, 2) + "\n");

  console.log(`publication  ${result.publicationUri}`);
  console.log(`             ${pdslsLink(result.publicationUri)}\n`);
  for (const doc of result.documents) {
    console.log(`${doc.changed ? "published" : "unchanged"}  ${doc.title}`);
    console.log(`             ${doc.uri}`);
    console.log(`             ${pdslsLink(doc.uri)}`);
  }

  const shares = Object.entries(result.state.shares ?? {});
  if (shares.length) {
    console.log(`\nShare posts:`);
    for (const [slug, ref] of shares) {
      console.log(`  ${slug}`);
      console.log(`             ${bskyPostLink(publisher.did, ref.uri)}`);
    }
  }

  if (result.skipped.length) {
    console.log(`\nSkipped drafts (not published): ${result.skipped.join(", ")}`);
  }

  if (result.pruned.length) {
    console.log(`\nPruned (documents deleted): ${result.pruned.join(", ")}`);
  }

  if (result.warnings.length) {
    console.log(`\nWarnings:`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  console.log(`\nState saved to ${STATE_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
