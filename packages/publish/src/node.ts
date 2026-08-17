// The Node-only entry point (SLIMS-64): everything from the compatibility
// surface (./index.ts) PLUS atproto OAuth login for the CLI (oauth.ts) and the
// JSON-file store it persists sessions through (store.ts) — both import
// node:http/node:fs/node:child_process and so can never be part of the
// browser-focused "./site" export. A Node consumer imports this subpath to get
// the full surface through one import. See docs/architecture.md.
export * from "./index.js";
export * from "./oauth.js";
export { FileStore } from "./store.js";
