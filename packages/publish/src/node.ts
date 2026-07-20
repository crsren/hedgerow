// The Node-only entry point (SLIMS-64): everything from the isomorphic core
// (./index.ts) PLUS atproto OAuth login for the CLI (oauth.ts) and the
// JSON-file store it persists sessions through (store.ts) — both import
// node:http/node:fs/node:child_process and so can never be part of the
// browser-safe "." export. A Node consumer (the demo's publish.mjs, any CLI
// script) imports this subpath instead of ".", getting the full surface
// through one import. See docs/architecture.md's package-dependency rules.
export * from "./index.js";
export * from "./oauth.js";
export { FileStore } from "./store.js";
