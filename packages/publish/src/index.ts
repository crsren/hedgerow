// The isomorphic core (SLIMS-64): record shapes, pure transforms, publishSite's
// upsert logic, and the unauthenticated read path — all safe to import from a
// browser bundle. Node-only auth (oauthPublisher, the CLI loopback login,
// FileStore) lives under the "./node" subpath (see node.ts) so a browser
// consumer (e.g. the demo's /edit island, via @hedgerow/reader's
// asPublisher()) never drags in node:http/node:fs. See docs/architecture.md.
export * from "./types.js";
export * from "./records.js";
export * from "./auth.js";
export * from "./publish.js";
export * from "./read.js";
export * from "./anchor.js";
