#!/usr/bin/env node
// prepublishOnly guard: never let a prerelease take the `latest` dist-tag.
//
// npm decides `latest` from the --tag flag, NOT from the version string.
// `npm publish` of 0.2.0-next.0 with no --tag makes it `latest`, and every
// `npm install @hedgerow/react` in the world starts resolving to a beta.
// Semver prerelease syntax gives exactly zero protection here.
//
// `changeset publish` gets this right on its own (pre mode passes --tag), so
// this guard exists for the path that doesn't: a hand-run `pnpm publish` from
// a package directory, which is precisely how this mistake gets made.
//
// Fails CLOSED but narrowly: it only objects when the version is a prerelease
// AND the tag would be `latest`. A stable version publishes untouched, and an
// explicitly-tagged prerelease publishes untouched.
//
// Recovery if it ever does happen: dist-tags are the one fully reversible
// part of npm — `npm dist-tag add <pkg>@<good-version> latest` fixes it.

// Read the version from disk rather than npm_package_version. prepublishOnly
// runs with cwd = the package directory, and relying on the env var meant the
// guard silently disarmed itself (exit 0) whenever a package manager didn't
// set it — on precisely the hand-run path this exists to catch.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
const name = process.env.npm_package_name ?? "this package";
const tag = process.env.npm_config_tag;

if (!version) {
  console.error("assert-dist-tag: no version in ./package.json — refusing to publish.");
  process.exit(1);
}

const isPrerelease = version.includes("-");
const takesLatest = tag === undefined || tag === "" || tag === "latest";

if (isPrerelease && takesLatest) {
  console.error(
    `\nRefusing to publish ${name}@${version}.\n\n` +
      `  This is a prerelease, but no dist-tag was given, so npm would publish it\n` +
      `  as "latest" — every plain \`npm install\` would start resolving to it.\n` +
      `  npm assigns "latest" from the --tag flag, not from the version string.\n\n` +
      `  Publish it under a tag instead:  pnpm publish --tag next\n` +
      `  Or, for a prerelease line, use changesets pre mode:\n` +
      `    pnpm changeset pre enter next   (and \`pre exit\` when done)\n`,
  );
  process.exit(1);
}

console.log(
  `assert-dist-tag: ${version} -> tag ${tag || "latest"} — ok.`,
);
