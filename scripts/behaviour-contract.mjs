#!/usr/bin/env node
// Behavioural contract report — the half of the public API that has no types.
//
// WHY THIS EXISTS
//
// `api-report/*.api.d.ts` answers "did the type surface change?". It cannot see
// the other way these packages break people, and that way is worse:
//
//   * LEXICONS. `packages/publish/lexicons/**` defines records written into
//     strangers' atproto repos. Those records are already out there and stay
//     there. Renaming a field or making one required doesn't break a build —
//     it breaks data that has already been published and cannot be migrated,
//     because it lives in repositories we don't control.
//
//   * PERSISTENCE KEYS. The cached OAuth session path and filenames. Rename
//     one and every existing user is silently signed out, with identical
//     types and a fully green test suite.
//
//   * THE LOOPBACK PORT. It's encoded in the OAuth client id, so changing it
//     invalidates every authorization already granted.
//
// None of these are visible to the type checker, to tests, or to a reviewer
// reading a diff of `src/`. So we snapshot them, commit the snapshot, and let
// the same gate that guards the API report guard this too: the file lives in
// api-report/, so `check-changesets.mjs` already fails a PATCH bump that
// removes or changes a line here.
//
// Usage: driven by `pnpm api:report` / `pnpm api:check` — not run directly.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// Constants whose VALUE is a promise to users, not an implementation detail.
// Named explicitly: a blanket "snapshot every const" would drown the real
// commitments in noise, and noise is what kills a report like this.
const TRACKED_CONSTANTS = [
  {
    file: "packages/publish/src/oauth.ts",
    names: ["ATPROTO_SCOPE", "DEFAULT_PORT", "DEFAULT_STORE_DIR", "STATE_FILE", "SESSION_FILE"],
    why: "cached session location + the client id's encoded port",
  },
  {
    file: "packages/publish/src/types.ts",
    names: ["DOCUMENT_NSID", "PUBLICATION_NSID", "MARKDOWN_CONTENT_NSID", "VIA_KEY", "VIA_VALUE"],
    why: "record collection names (the addresses records live at) and the tool-attribution stamp written into every document",
  },
  {
    file: "packages/publish/src/read.ts",
    names: ["DEFAULT_RESOLVE_HANDLE_SERVICE", "DEFAULT_PLC_URL"],
    why: "which third-party services an unconfigured read path talks to",
  },
  // Runtime DEFAULTS are the sharpest instance of the typeless-break problem,
  // and the one the test suites demonstrably miss: changing DEFAULT_MAX_DEPTH
  // from 10 to 6 silently truncates every consumer's thread, passes all 44
  // comments tests, passes typecheck, and produces no api-report diff.
  // (Sort ORDER is fine — packages/comments/test/sort.test.ts covers it. It's
  // the unexercised default values that slip through.)
  {
    file: "packages/comments/src/thread.ts",
    names: ["DEFAULT_MAX_DEPTH", "MAX_SUPPORTED_DEPTH"],
    why: "how deep a thread renders when the caller says nothing",
  },
  {
    file: "packages/comments/src/likes.ts",
    names: ["DEFAULT_PAGE_SIZE", "DEFAULT_MAX_PAGES"],
    why: "how many likes get fetched — caps what consumers see",
  },
  {
    file: "packages/comments/src/resolve.ts",
    names: ["DEFAULT_CACHE_TTL_MS"],
    why: "how long a resolved post stays cached",
  },
  {
    file: "packages/comments/src/xrpc.ts",
    names: ["DEFAULT_APPVIEW", "POST_COLLECTION"],
    why: "which AppView an unconfigured read hits, and what it reads",
  },
  {
    file: "packages/react/src/useComments.ts",
    names: ["DEFAULT_CONFIRM_RETRY_DELAYS", "CONFIRMED_FLASH_MS"],
    why: "optimistic-reply retry timing consumers build UI around",
  },
  {
    file: "packages/reader/src/reader.ts",
    names: ["ATPROTO_SCOPE", "DEFAULT_SIGNUP_SERVICE", "LIKE_COLLECTION"],
    why: "OAuth scope requested of the visitor, and where signup lands",
  },
];

export function buildBehaviourContract(repoRoot) {
  const lines = [
    "# Behavioural contract — GENERATED, DO NOT EDIT.",
    "#",
    "# Regenerate with `pnpm api:report`. Everything here is a promise to people",
    "# whose data already exists. A change to any line is BREAKING even when the",
    "# type surface is untouched — see scripts/behaviour-contract.mjs.",
    "",
    "## Record lexicons (the wire format)",
    "",
  ];

  // --- lexicons: normalised so field-level changes are visible -------------

  const lexiconRoot = join(repoRoot, "packages/publish/lexicons");
  const lexiconFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) lexiconFiles.push(full);
    }
  };
  if (existsSync(lexiconRoot)) walk(lexiconRoot);

  for (const file of lexiconFiles) {
    const lexicon = JSON.parse(readFileSync(file, "utf8"));
    lines.push(`### ${lexicon.id}   (${relative(repoRoot, file)})`);
    for (const [defName, def] of Object.entries(lexicon.defs ?? {})) {
      const record = def.type === "record" ? def.record : def;
      const required = new Set(record?.required ?? []);
      const props = record?.properties ?? {};
      const key = def.type === "record" ? `record ${defName} (key: ${def.key ?? "?"})` : `${def.type} ${defName}`;
      lines.push(`  ${key}`);
      for (const propName of Object.keys(props).sort()) {
        const prop = props[propName];
        const flag = required.has(propName) ? "required" : "optional";
        const type = prop.type === "array" ? `array<${prop.items?.type ?? prop.items?.ref ?? "?"}>` : prop.type;
        const ref = prop.ref ? ` -> ${prop.ref}` : "";
        lines.push(`    ${propName}: ${type}${ref} (${flag})`);
      }
    }
    lines.push("");
  }

  // --- tracked constants ---------------------------------------------------

  lines.push("## Persisted state and identity constants", "");

  for (const { file, names, why } of TRACKED_CONSTANTS) {
    const abs = join(repoRoot, file);
    if (!existsSync(abs)) {
      throw new Error(
        `behaviour-contract: tracked file ${file} no longer exists. ` +
          `If it moved, update TRACKED_CONSTANTS in scripts/behaviour-contract.mjs.`,
      );
    }
    lines.push(`### ${file} — ${why}`);
    const sourceFile = ts.createSourceFile(file, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    const found = new Map();
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
        found.set(node.name.text, node.initializer ? node.initializer.getText(sourceFile) : "<no initializer>");
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    for (const name of names) {
      if (!found.has(name)) {
        // A tracked constant vanishing is itself the breaking change we're
        // watching for — surface it in the report rather than throwing, so the
        // diff shows exactly what disappeared.
        lines.push(`  ${name} = <REMOVED OR RENAMED>`);
      } else {
        lines.push(`  ${name} = ${found.get(name)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
