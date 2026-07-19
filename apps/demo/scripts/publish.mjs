// Publish the demo's local posts as site.standard records to a real PDS.
//
//   ATP_IDENTIFIER=you.bsky.social \
//   ATP_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//   pnpm --filter @hedgerow/demo run publish:pds
//
// Flags:
//   --share  auto-create a canonical Bluesky share post for any post lacking a
//            comment anchor, and use it as the document's bskyPostRef.
//   --prune  delete document records for slugs no longer in ./posts.
//
// State (slug -> record rkey) persists to .publish-state.json so reruns target
// the same records; unchanged posts are skipped (the `changed` flag).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  parsePost,
  publishSite,
  appPasswordPublisher,
  emptyState,
} from "@hedgerow/publish";

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
  const { ATP_IDENTIFIER, ATP_APP_PASSWORD, ATP_SERVICE } = process.env;
  if (!ATP_IDENTIFIER || !ATP_APP_PASSWORD) {
    console.error(
      "Missing credentials. Set ATP_IDENTIFIER and ATP_APP_PASSWORD (and optionally ATP_SERVICE).",
    );
    process.exit(1);
  }

  const share = process.argv.includes("--share");
  const prune = process.argv.includes("--prune");

  const posts = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parsePost(readFileSync(join(POSTS_DIR, f), "utf8"), f.replace(/\.md$/, "")));

  console.log(`Publishing ${posts.length} post(s) as ${ATP_IDENTIFIER}…\n`);

  const publisher = await appPasswordPublisher({
    identifier: ATP_IDENTIFIER,
    password: ATP_APP_PASSWORD,
    service: ATP_SERVICE, // undefined -> defaults to https://bsky.social
  });

  const result = await publishSite(publisher, config, posts, loadState(), {
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
