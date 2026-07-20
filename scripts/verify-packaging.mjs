#!/usr/bin/env node
// Packaging smoke test (SLIMS-70).
//
// The exports maps in packages/*/package.json carry a `development` condition
// that points straight at ./src/*.ts — a monorepo convenience so workspace
// consumers (other packages, the demo app, vitest) get live TypeScript
// without a build step. That condition, and the raw `src/` it points at,
// must never reach npm: webpack/Next.js resolve conditions in declaration
// order and will happily pick `development` over `import`, handing
// unbundled TypeScript to a consumer's bundler and breaking the build.
// CJS/Jest resolvers don't understand `development` at all and fail outright.
//
// This script packs each publishable package exactly as `pnpm publish`
// would, then inspects the tarball to prove:
//   1. the published exports map has no `development` condition,
//   2. no `src/` ships in the tarball,
//   3. `dist/` is present,
//   4. every exports condition object ends with a trailing `default`,
//   5. @hedgerow/react's dist entry starts with a literal "use client"
//      directive,
//   6. a real Node ESM `import()` of the published package resolves and
//      evaluates (proving the exports map + conditions actually work end to
//      end, not just that the JSON looks right).
//
// It also spot-checks the *source* package.json (pre-pack) still declares
// `development` + a trailing `default`, so a future edit can't silently
// drop the monorepo dev path while satisfying the publish-time checks.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");

const failures = [];
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    console.log(`  FAIL - ${label}${detail ? `\n         ${detail}` : ""}`);
    failures.push(label);
  }
}

// --- discover publishable packages (private !== true) ----------------------

const fs = await import("node:fs/promises");
const pkgDirs = (await fs.readdir(packagesDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const packages = [];
for (const dir of pkgDirs) {
  const pkgJsonPath = join(packagesDir, dir, "package.json");
  if (!existsSync(pkgJsonPath)) continue;
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (pkgJson.private === true) continue;
  packages.push({ dir, path: join(packagesDir, dir), name: pkgJson.name, pkgJson });
}

if (packages.length === 0) {
  console.error("No publishable packages found under packages/*.");
  process.exit(1);
}

console.log(`Publishable packages: ${packages.map((p) => p.name).join(", ")}\n`);

// --- helpers -----------------------------------------------------------------

function containsDevelopmentCondition(exportsField) {
  if (exportsField == null || typeof exportsField !== "object") return false;
  for (const [key, value] of Object.entries(exportsField)) {
    if (key === "development") return true;
    if (typeof value === "object" && value !== null) {
      if (containsDevelopmentCondition(value)) return true;
    }
  }
  return false;
}

// Every leaf conditions object (an object whose values are all strings, i.e.
// not further nested subpaths) must end with "default" as its last key —
// resolvers walk conditions in declaration order, so "default" only works
// as a true fallback when it comes last.
function everyLeafEndsWithDefault(exportsField) {
  if (exportsField == null || typeof exportsField !== "object") return true;
  const values = Object.values(exportsField);
  const isLeaf = values.every((v) => typeof v === "string");
  if (isLeaf) {
    const keys = Object.keys(exportsField);
    return keys.length > 0 && keys.at(-1) === "default";
  }
  return Object.values(exportsField).every((v) => everyLeafEndsWithDefault(v));
}

function runPnpmPack(pkgPath, destDir) {
  const out = execFileSync("pnpm", ["pack", "--json", "--pack-destination", destDir], {
    cwd: pkgPath,
    encoding: "utf8",
  });
  // pnpm pack --json can emit non-JSON banner lines (e.g. npm config
  // warnings) before the JSON payload; find the JSON object.
  const jsonStart = out.indexOf("{");
  return JSON.parse(out.slice(jsonStart));
}

// --- pass 1: source (pre-pack) package.json sanity -------------------------

console.log("Source package.json (pre-pack) checks:");
for (const pkg of packages) {
  console.log(`${pkg.name}:`);
  check(
    "exports map declares a `development` condition (monorepo dev path)",
    containsDevelopmentCondition(pkg.pkgJson.exports),
  );
  check(
    "every exports condition object ends with a trailing `default`",
    everyLeafEndsWithDefault(pkg.pkgJson.exports),
  );
  const publishExports = pkg.pkgJson.publishConfig?.exports;
  check(
    "publishConfig.exports is set and carries no `development` condition",
    publishExports != null && !containsDevelopmentCondition(publishExports),
  );
  check(
    "publishConfig.exports also ends every leaf with a trailing `default`",
    publishExports != null && everyLeafEndsWithDefault(publishExports),
  );
  check(
    "top-level `files` does not list `src` (nothing else ships it to npm either)",
    !(pkg.pkgJson.files ?? []).includes("src"),
  );
}
console.log();

// --- pass 2: pack + inspect the tarball -------------------------------------

const workRoot = mkdtempSync(join(tmpdir(), "hedgerow-verify-packaging-"));
const tarballsDir = join(workRoot, "tarballs");
const extractedDir = join(workRoot, "extracted");
mkdirSync(tarballsDir, { recursive: true });
mkdirSync(extractedDir, { recursive: true });

const packed = []; // { name, dir (extracted), manifest }

console.log("Packed tarball checks:");
for (const pkg of packages) {
  console.log(`${pkg.name}:`);
  const result = runPnpmPack(pkg.path, tarballsDir);

  const filePaths = result.files.map((f) => f.path);
  check(
    "no src/ in the tarball",
    !filePaths.some((p) => p === "src" || p.startsWith("src/")),
    `tarball contents: ${filePaths.join(", ")}`,
  );
  check(
    "dist/ is present in the tarball",
    filePaths.some((p) => p.startsWith("dist/")),
  );

  const extractTo = join(extractedDir, pkg.dir);
  mkdirSync(extractTo, { recursive: true });
  execFileSync("tar", ["-xzf", result.filename, "-C", extractTo, "--strip-components=1"]);

  const manifest = JSON.parse(readFileSync(join(extractTo, "package.json"), "utf8"));
  check(
    "packed package.json exports map has no `development` condition",
    !containsDevelopmentCondition(manifest.exports),
    JSON.stringify(manifest.exports),
  );
  check(
    "packed package.json exports map ends every leaf with a trailing `default`",
    everyLeafEndsWithDefault(manifest.exports),
    JSON.stringify(manifest.exports),
  );
  check(
    "packed dist/index.js exists",
    existsSync(join(extractTo, "dist", "index.js")),
  );

  if (pkg.name === "@hedgerow/react") {
    const entry = readFileSync(join(extractTo, "dist", "index.js"), "utf8");
    const firstLine = entry.split("\n")[0].trim();
    check(
      '"use client" is the literal first line of dist/index.js',
      firstLine === '"use client";',
      `first line was: ${JSON.stringify(firstLine)}`,
    );
  }

  packed.push({ name: pkg.name, dir: extractTo, manifest });
  console.log();
}

// --- pass 3: real Node ESM resolution ---------------------------------------
//
// Build a scratch node_modules by hand (no network, no npm registry lookups —
// our @hedgerow/* packages aren't published, and pinning down every
// transitive third-party dep would make this test flaky/offline-hostile).
// This still exercises the real thing we're worried about: Node's package
// exports resolver walking the *packed* exports map, the same algorithm a
// consumer's bundler/runtime uses.

console.log("Node ESM resolution checks:");
const resolveRoot = join(workRoot, "resolve-root");
const resolveNodeModules = join(resolveRoot, "node_modules", "@hedgerow");
mkdirSync(resolveNodeModules, { recursive: true });

for (const p of packed) {
  const scopedName = p.name.split("/")[1]; // "@hedgerow/react" -> "react"
  execFileSync("cp", ["-R", p.dir, join(resolveNodeModules, scopedName)]);
}

// Each package's real (third-party) runtime dependencies, plus @hedgerow/react's
// peer deps (react, react-dom), need to be resolvable too or evaluating the
// entry module throws MODULE_NOT_FOUND before we ever get to test our own
// exports map. Rather than `npm install` from the real registry (our
// @hedgerow/* packages aren't published there, and it'd make this test
// network-dependent and flaky), symlink in the copies the workspace already
// resolved for that package under packages/<dir>/node_modules — same
// dependency, zero network calls.
const resolveNodeModulesRoot = join(resolveRoot, "node_modules");
const runtimeDepsToLink = new Set(["react", "react-dom"]); // @hedgerow/react peers
for (const pkg of packages) {
  for (const dep of Object.keys(pkg.pkgJson.dependencies ?? {})) {
    if (!dep.startsWith("@hedgerow/")) runtimeDepsToLink.add(dep);
  }
}
for (const dep of runtimeDepsToLink) {
  const resolved = packages
    .map((p) => join(p.path, "node_modules", dep))
    .find((candidate) => existsSync(candidate));
  if (!resolved) continue;
  const dest = join(resolveNodeModulesRoot, dep);
  mkdirSync(dirname(dest), { recursive: true });
  symlinkSync(realpathSync(resolved), dest);
}

for (const p of packed) {
  try {
    const out = execFileSync(
      "node",
      [
        "-e",
        `
        import(${JSON.stringify(p.name)}).then((mod) => {
          const keys = Object.keys(mod);
          if (keys.length === 0) throw new Error("module namespace has no exports");
          process.stdout.write(keys.join(","));
          // Some deps (e.g. @atproto/oauth-client-browser) register timers/
          // listeners at import time that keep the event loop alive forever
          // in a bare Node process — irrelevant to whether *resolution*
          // worked, so force the exit once we've observed success.
          process.exit(0);
        }).catch((err) => {
          console.error(err.stack || String(err));
          process.exit(1);
        });
        `,
      ],
      { cwd: resolveRoot, encoding: "utf8", timeout: 15_000 },
    );
    check(`import("${p.name}") resolves and evaluates`, true, `exports: ${out}`);
  } catch (err) {
    check(`import("${p.name}") resolves and evaluates`, false, err.stderr?.toString() || err.message);
  }
}

console.log();
rmSync(workRoot, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`All packaging checks passed for ${packages.length} package(s).`);
