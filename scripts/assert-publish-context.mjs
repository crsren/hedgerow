#!/usr/bin/env node
// prepublishOnly guard: publishing happens in CI, not on someone's laptop.
//
// The release model is "merging the Version Packages PR is the release". That
// is currently a POLICY — a sentence in CLAUDE.md and CONTRIBUTING.md asking
// people and agents not to run `pnpm release` locally. A logged-in npm session
// on the maintainer's machine is all it takes to bypass it, and an agent that
// decides publishing is the helpful next step will find nothing in its way.
//
// This makes the policy mechanical. A local publish now requires deliberately
// setting HEDGEROW_ALLOW_LOCAL_PUBLISH=1 — something a human does knowingly and
// an agent has been told (in CLAUDE.md) never to do. The escape hatch exists
// because the FIRST publish of a new package name must come from a maintainer
// machine: npm trusted publishing can only be configured on a package that
// already exists.
//
// Not a security boundary — anyone determined can set the variable. It's a
// guard against the actual failure mode here, which is a confused agent or an
// absent-minded 2am `pnpm release`, not an attacker.

const inCI = process.env.CI === "true" || process.env.CI === "1" || Boolean(process.env.GITHUB_ACTIONS);
const override = process.env.HEDGEROW_ALLOW_LOCAL_PUBLISH === "1";
const name = process.env.npm_package_name ?? "this package";

if (inCI) {
  console.log("assert-publish-context: running in CI — ok.");
  process.exit(0);
}

if (override) {
  console.warn(
    `assert-publish-context: LOCAL PUBLISH of ${name}, override is set.\n` +
      `  This bypasses the Version Packages PR. Correct for bootstrapping a new\n` +
      `  package name; wrong for a normal release.`,
  );
  process.exit(0);
}

console.error(
  `\nRefusing to publish ${name} from a local machine.\n\n` +
    `  Releases go out from CI, and the release decision is made by merging the\n` +
    `  "Version Packages" PR that changesets opens. That PR shows the exact\n` +
    `  version numbers and changelog before anything reaches npm.\n\n` +
    `  A published name@version can never be reused, so this is deliberately\n` +
    `  not something to do by hand on a whim.\n\n` +
    `  To release:  add a changeset, merge to main, then merge the Version\n` +
    `               Packages PR that appears.\n\n` +
    `  If you are bootstrapping a brand-new package name (npm trusted publishing\n` +
    `  can only be configured on a package that already exists), that is the one\n` +
    `  legitimate local publish:\n\n` +
    `    HEDGEROW_ALLOW_LOCAL_PUBLISH=1 pnpm release\n`,
);
process.exit(1);
