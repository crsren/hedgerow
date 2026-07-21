#!/usr/bin/env node
// Public API surface report.
//
// WHY THIS EXISTS
//
// The hardest part of releasing a library is answering "is this change
// breaking?" — and it's a question people (and agents) answer from memory,
// badly, under time pressure. Get it wrong pre-1.0 and you ship a breaking
// change as a patch; consumers' builds break on an npm install they had every
// reason to think was safe.
//
// The answer is not judgement, it's a diff. Every package here already emits
// a single bundled .d.ts — a complete, self-contained description of exactly
// what a consumer can import. So we commit those files under api-report/ and
// let CI fail when the committed copy drifts from the built one.
//
// The effect: any PR that changes the public surface SHOWS that change, in
// review, as a diff of removed and added signatures. "Is this breaking?"
// becomes "read this diff" — which a human or an agent can actually do.
//
//   removed export, renamed export, narrowed parameter,
//   new required field, changed return type          -> BREAKING
//   new optional export, new optional field, docs     -> non-breaking
//
// Pre-1.0 that maps to: breaking -> minor, otherwise -> patch.
// (Never major before 1.0 — see CONTRIBUTING.md and check-changesets.mjs.)
//
// Usage:
//   pnpm api:report   # regenerate the committed reports (after a build)
//   pnpm api:check    # fail if the committed reports are stale
//
// Both assume packages are already built; the pnpm scripts handle that.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildBehaviourContract } from "./behaviour-contract.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");
const reportDir = join(repoRoot, "api-report");

const check = process.argv.includes("--check");

// Normalise a built .d.ts down to just its type structure.
//
// The report is read to answer ONE question — did the shape consumers depend
// on change? JSDoc prose and blank lines answer none of it, and they generate
// most of the churn: fix a typo in a doc comment and the raw .d.ts diff lights
// up. A report that cries wolf gets regenerated and scrolled past, which is
// exactly the failure this whole mechanism exists to prevent. So strip
// comments via TypeScript's own printer (not a regex — `//` inside a string
// literal is not a comment) and keep only the declarations.
const require = createRequire(import.meta.url);
const ts = require("typescript");

function normaliseDeclarations(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return (
    sourceFile.statements
      .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile))
      .filter((text) => text.trim() !== "")
      .join("\n") + "\n"
  );
}

const HEADER = (pkgName) =>
  `// API report for ${pkgName} — GENERATED, DO NOT EDIT.\n` +
  `//\n` +
  `// Regenerate with \`pnpm api:report\`. A diff in this file is a change to\n` +
  `// what consumers can import — read it to decide the version bump.\n` +
  `// See CONTRIBUTING.md ("Choosing the version bump").\n\n`;

// --- collect the built .d.ts for every publishable package ------------------

const reports = new Map(); // report filename -> contents

for (const dir of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!dir.isDirectory()) continue;
  const pkgJsonPath = join(packagesDir, dir.name, "package.json");
  if (!existsSync(pkgJsonPath)) continue;
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (pkgJson.private === true) continue;

  const distDir = join(packagesDir, dir.name, "dist");
  if (!existsSync(distDir)) {
    console.error(
      `No dist/ for ${pkgJson.name}. Build first (\`pnpm build\`) — this script reads built .d.ts.`,
    );
    process.exit(1);
  }

  // One report per declaration entry point, so a package with subpath exports
  // (e.g. @hedgerow/publish's "./node") gets each surface reported separately.
  const dtsFiles = readdirSync(distDir)
    .filter((f) => f.endsWith(".d.ts"))
    .sort();

  if (dtsFiles.length === 0) {
    console.error(`No .d.ts emitted for ${pkgJson.name} — is \`dts\` enabled in its tsup config?`);
    process.exit(1);
  }

  for (const dts of dtsFiles) {
    const entry = dts.replace(/\.d\.ts$/, "");
    const reportName = entry === "index" ? `${dir.name}.api.d.ts` : `${dir.name}.${entry}.api.d.ts`;
    const declarations = normaliseDeclarations(readFileSync(join(distDir, dts), "utf8"), dts);
    reports.set(reportName, HEADER(pkgJson.name) + declarations);
  }
}

// The typeless half of the public API: wire format, persisted state keys, the
// OAuth loopback port. Lives alongside the type reports so the same bump gate
// in check-changesets.mjs covers it — a removal here can't ship as a patch.
reports.set("behaviour-contract.api.d.ts", buildBehaviourContract(repoRoot) + "\n");

if (reports.size === 0) {
  console.error("No publishable packages found under packages/*.");
  process.exit(1);
}

// --- write, or compare -------------------------------------------------------

mkdirSync(reportDir, { recursive: true });

if (!check) {
  // Drop reports for packages/entry points that no longer exist, so a removed
  // export surface can't linger as a stale committed file.
  // Actually delete, so git shows a deletion — which is the review signal we
  // want, and which `--check` then agrees with. (Truncating instead would
  // leave a 0-byte file that --check still rejects as unknown, making the
  // documented fix "run api:report" fail to fix the failure.)
  for (const existing of readdirSync(reportDir)) {
    if (existing.endsWith(".api.d.ts") && !reports.has(existing)) {
      rmSync(join(reportDir, existing));
      console.log(`  removed stale api-report/${existing}`);
    }
  }
  for (const [name, contents] of reports) {
    writeFileSync(join(reportDir, name), contents);
    console.log(`  wrote api-report/${name}`);
  }
  console.log(`\nAPI report written for ${reports.size} entry point(s).`);
  process.exit(0);
}

const stale = [];
for (const [name, contents] of reports) {
  const path = join(reportDir, name);
  if (!existsSync(path)) {
    stale.push(`${name} is missing`);
    continue;
  }
  if (readFileSync(path, "utf8") !== contents) stale.push(`${name} is out of date`);
}
for (const existing of readdirSync(reportDir)) {
  if (existing.endsWith(".api.d.ts") && !reports.has(existing)) {
    stale.push(`${existing} has no corresponding package entry point`);
  }
}

if (stale.length > 0) {
  console.error(
    `\nThe committed API report does not match the built types:\n` +
      stale.map((s) => `  - ${s}`).join("\n") +
      `\n\nThis means your change altered the public API surface.\n` +
      `Run \`pnpm api:report\` and commit the result — then READ the diff:\n` +
      `an export removed, renamed, or narrowed is a BREAKING change, which\n` +
      `pre-1.0 means a MINOR bump in your changeset. See CONTRIBUTING.md.\n`,
  );
  process.exit(1);
}

console.log(`API report is up to date (${reports.size} entry point(s)).`);
