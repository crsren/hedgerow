#!/usr/bin/env node
// Changeset policy gate.
//
// Four checks, all of which exist because the failure they catch
// is silent — nothing goes red at the time, the mistake only surfaces later
// as a wrong version number on npm, which is unfixable (a published
// name@version is burned forever).
//
//   1. PRESENCE — a change to a publishable package must come with a
//      changeset. Without one the change merges, ships in no release, and
//      the changelog quietly loses an entry. Solo repos and agent-authored
//      PRs have no reviewer who'd notice.
//
//   2. BUMP vs API SURFACE — if the committed API report lost declarations,
//      the change is breaking and cannot ship as a patch. This is what makes
//      the API report load-bearing rather than advisory.
//
//   3. SUMMARY QUALITY — a changeset with no real summary produces a
//      changelog entry no consumer can act on.
//
//   4. PRE-1.0 BUMP POLICY — while a package is 0.x, a breaking change must
//      be declared `minor`, never `major`. Changesets does NOT implement
//      SemVer's 0.x rule: selecting `major` on 0.1.0 produces 1.0.0, not
//      0.2.0. So the one honest mistake here (picking `major` because the
//      change genuinely is breaking) silently declares the package stable
//      and burns the 1.0.0 version number. This check is the enforcement of
//      the rule written in CONTRIBUTING.md.
//
// Usage:
//   node scripts/check-changesets.mjs            # policy only (all refs)
//   node scripts/check-changesets.mjs --base <ref>   # + presence vs <ref>
//
// Presence is skipped without --base (nothing to diff against), and can be
// waived per-PR with the `no-changeset` label — see .github/workflows/ci.yml.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const changesetDir = join(repoRoot, ".changeset");
const packagesDir = join(repoRoot, "packages");

const baseFlag = process.argv.indexOf("--base");
const baseRef = baseFlag === -1 ? null : process.argv[baseFlag + 1];
// Deliberate waiver for the case the API-surface heuristic gets wrong: a
// removal that genuinely isn't consumer-visible. Applied via the
// `api-additive` PR label, so waiving is a recorded act, not a silent flag.
const allowApiRemovals = process.argv.includes("--allow-api-removals");

if (baseFlag !== -1 && !baseRef) {
  console.error("--base needs a ref argument (e.g. --base origin/main).");
  process.exit(1);
}

const errors = [];

// --- the publishable packages, and their current versions ------------------

const publishable = new Map(); // name -> { dir, version }
for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(join(packagesDir, dir.name, "package.json"), "utf8"));
  } catch {
    continue; // no package.json here
  }
  if (pkgJson.private === true) continue;
  publishable.set(pkgJson.name, { dir: dir.name, version: pkgJson.version });
}

// --- parse the pending changesets ------------------------------------------
//
// A changeset is markdown with a YAML-ish frontmatter block listing
// `"package-name": bump` lines. We only need those lines, so we parse the
// frontmatter directly rather than depending on @changesets internals.

const changesetFiles = readdirSync(changesetDir).filter(
  (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
);

const parsed = []; // { file, bumps: Map<pkgName, bump>, summary }
for (const file of changesetFiles) {
  const raw = readFileSync(join(changesetDir, file), "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    errors.push(`${file}: no frontmatter block — is this a valid changeset?`);
    continue;
  }
  const [, frontmatter, body] = match;
  const bumps = new Map();
  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const entry = trimmed.match(/^["']?(@?[^"':]+)["']?\s*:\s*["']?(\w+)["']?$/);
    if (!entry) {
      errors.push(`${file}: could not parse frontmatter line: ${JSON.stringify(trimmed)}`);
      continue;
    }
    bumps.set(entry[1].trim(), entry[2]);
  }
  if (bumps.size === 0) {
    errors.push(
      `${file}: frontmatter names no packages, so this changeset releases nothing.\n` +
        `    Delete it, or list the package(s) it covers.`,
    );
  }
  parsed.push({ file, bumps, summary: body.trim() });
}

// --- check 2: bump policy ---------------------------------------------------

for (const { file, bumps, summary } of parsed) {
  for (const [name, bump] of bumps) {
    const pkg = publishable.get(name);
    if (!pkg) {
      errors.push(
        `${file}: names "${name}", which is not a publishable package ` +
          `(known: ${[...publishable.keys()].join(", ")})`,
      );
      continue;
    }
    if (!["major", "minor", "patch"].includes(bump)) {
      errors.push(`${file}: "${name}" has bump "${bump}" — expected major, minor, or patch.`);
      continue;
    }
    if (bump === "major" && pkg.version.startsWith("0.")) {
      errors.push(
        `${file}: "${name}" is at ${pkg.version} (pre-1.0) but requests a MAJOR bump.\n` +
          `    Changesets does not implement SemVer's 0.x rule — this would publish 1.0.0,\n` +
          `    declaring the package stable, and 1.0.0 could never be reused.\n` +
          `    Pre-1.0, a breaking change is a MINOR bump. See CONTRIBUTING.md.\n` +
          `    Going to 1.0 is a deliberate, separate act: land a PR that moves\n` +
          `    packages/*/package.json off 0.x on its own, then release normally.\n` +
          `    There is no bypass flag here, and that is on purpose.`,
      );
    }
  }
  if (summary.length < 12) {
    errors.push(
      `${file}: summary is empty or too short. The changelog is the artifact users read\n` +
        `    when deciding whether to upgrade — write it for a stranger.`,
    );
  }
}

// --- check 1: presence ------------------------------------------------------

if (baseRef) {
  let changedFiles = [];
  try {
    changedFiles = execFileSync("git", ["diff", "--name-only", "--diff-filter=AM", `${baseRef}...HEAD`], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    console.error(`Could not diff against ${baseRef}: ${err.message}`);
    process.exit(1);
  }

  // Only source and manifest changes need a changeset. Tests, fixtures and a
  // package's own README don't alter what a consumer installs.
  const touchedPackages = new Set();
  for (const file of changedFiles) {
    const match = file.match(/^packages\/([^/]+)\//);
    if (!match) continue;
    const rest = file.slice(match[0].length);
    const isConsumerVisible =
      rest.startsWith("src/") ||
      rest === "package.json" ||
      rest.startsWith("lexicons/") ||
      // Build config decides what ships: dropping react's `"use client"`
      // banner, or changing format/target/externals, breaks consumers
      // without touching a line of src/.
      /^tsup\.config\./.test(rest) ||
      rest === "tsconfig.json";
    if (!isConsumerVisible) continue;
    const entry = [...publishable.values()].find((p) => p.dir === match[1]);
    if (entry) touchedPackages.add(match[1]);
  }

  const addedChangesets = changedFiles.filter(
    (f) => f.startsWith(".changeset/") && f.endsWith(".md") && !f.endsWith("README.md"),
  );

  // --- check 3: the declared bump must match what the API surface did -------
  //
  // This is the check that makes the API report worth having. Without it the
  // report is advisory: an agent can remove an export, run `pnpm api:report`,
  // commit the regenerated file, declare `patch`, and every gate goes green.
  // "Read the diff" was the only thing standing in the way, and reading is
  // exactly what gets skipped under time pressure.
  //
  // Signal used: REMOVED lines in api-report/. A declaration leaving the
  // public surface — deleted export, renamed export, narrowed signature,
  // field made required — always shows up as a removal. Purely additive
  // changes only add lines, and stay a legitimate `patch`.
  //
  // (Comments are stripped from the report, so a reworded doc comment cannot
  // produce a phantom removal — see scripts/api-report.mjs.)
  const apiReportDiff = (() => {
    try {
      return execFileSync("git", ["diff", "--unified=0", `${baseRef}...HEAD`, "--", "api-report/"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
    } catch {
      return ""; // diff already failed loudly above; don't double-report
    }
  })();

  const removedLines = apiReportDiff
    .split("\n")
    .filter((l) => l.startsWith("-") && !l.startsWith("---") && l.slice(1).trim() !== "");

  if (removedLines.length > 0 && parsed.length > 0 && !allowApiRemovals) {
    const declared = new Set(parsed.flatMap(({ bumps }) => [...bumps.values()]));
    if (!declared.has("minor") && !declared.has("major")) {
      errors.push(
        `The public API report lost ${removedLines.length} declaration line(s), but the\n` +
          `    pending changeset(s) only declare a PATCH bump.\n\n` +
          removedLines
            .slice(0, 12)
            .map((l) => `      ${l}`)
            .join("\n") +
          (removedLines.length > 12 ? `\n      ... and ${removedLines.length - 12} more` : "") +
          `\n\n    Something left the public surface — a removed or renamed export, a\n` +
          `    narrowed signature, a field made required. That is a BREAKING change,\n` +
          `    which pre-1.0 means a MINOR bump. See CONTRIBUTING.md.\n` +
          `    If these removals are genuinely not consumer-visible, add the\n` +
          `    \`api-additive\` label to say so deliberately.`,
      );
    }
  }

  if (touchedPackages.size > 0 && addedChangesets.length === 0) {
    errors.push(
      `These packages changed but no changeset was added: ${[...touchedPackages].join(", ")}.\n` +
        `    Run \`pnpm changeset\` and describe the change. Without one it ships in no\n` +
        `    release and the changelog silently loses an entry.\n` +
        `    If the change genuinely doesn't affect consumers, add the \`no-changeset\` label.`,
    );
  }
}

// --- prerelease mode notice --------------------------------------------------
//
// Not an error — a prerelease line is a legitimate state, and failing here
// would block the very releases it's meant to protect. But leaving pre mode
// on by accident means every subsequent release quietly ships under a
// non-latest tag while `latest` rots, and nothing else would ever say so.
// Printing it on every run is what makes it impossible to forget.

const preStatePath = join(changesetDir, "pre.json");
if (existsSync(preStatePath)) {
  let tag = "unknown";
  try {
    tag = JSON.parse(readFileSync(preStatePath, "utf8")).tag ?? tag;
  } catch {
    // fall through with "unknown" — the notice matters more than the tag
  }
  console.log(
    `\n  NOTE: this repo is in PRERELEASE mode (tag: ${tag}).\n` +
      `  Releases publish under the "${tag}" dist-tag, NOT "latest".\n` +
      `  Run \`pnpm changeset pre exit\` when the prerelease line is done.\n`,
  );
}

// --- report -----------------------------------------------------------------

if (errors.length > 0) {
  console.error(`Changeset policy: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  - ${e}\n`);
  process.exit(1);
}

const pkgCount = publishable.size;
console.log(
  parsed.length === 0
    ? `Changeset policy OK — no pending changesets, ${pkgCount} publishable package(s).`
    : `Changeset policy OK — ${parsed.length} pending changeset(s) across ${pkgCount} package(s).`,
);
