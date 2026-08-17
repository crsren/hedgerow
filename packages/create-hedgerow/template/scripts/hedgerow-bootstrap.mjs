import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { syncMarkdown } from "hedgerow/node";
import config from "../hedgerow.config.mjs";

const statePath = fileURLToPath(new URL("../.hedgerow/state.json", import.meta.url));
const state = JSON.parse(await readFile(statePath, "utf8"));

const result = await syncMarkdown({
  auth: {
    identifier: process.env.ATP_IDENTIFIER ?? config.authorDid,
  },
  publication: {
    url: config.siteUrl,
    name: config.siteName,
  },
  posts: [],
  state,
});

if (!result.publicationUri.startsWith(`at://${config.authorDid}/`)) {
  throw new Error(
    `Signed in as the wrong account. Expected ${config.authorDid}, received ${result.publicationUri}.`,
  );
}

await writeFile(statePath, `${JSON.stringify(result.state, null, 2)}\n`, "utf8");
console.log(`Publication ready: ${result.publicationUri}`);
console.log("Commit .hedgerow/state.json, then start the site and open /sudo.");
