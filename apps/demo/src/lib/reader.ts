// Shared reader identity + local/test-network env overrides (SLIMS-64), read
// from Astro's client-exposed env vars (Vite only exposes PUBLIC_-prefixed
// vars to browser code via import.meta.env — see apps/demo/scripts/dev-net.mjs,
// which sets these when pointing the demo at a fully local atproto network,
// and docs/local-testing.md). All five are undefined in production, in which
// case createReader()/appView fall back to their normal defaults (the public
// Bluesky AppView, a hosted/loopback OAuth client) — this override path never
// changes production behavior.
//
// Both the comments island (CommentThread.tsx, a page VISITOR replying) and
// the /edit author island (EditorIsland.tsx, SLIMS-64, the site OWNER signing
// in to edit their own posts) need the SAME reader identity wiring, so this
// is the one place that reads the env vars and builds the createReader()
// singleton — each is its own Astro page (a separate JS entry point/module
// graph), so each gets its own reader instance, same as the prior
// module-level singleton in CommentThread.tsx.
import { createReader } from "@hedgerow/reader";

export const appViewOverride = import.meta.env.PUBLIC_HEDGEROW_APPVIEW_URL as string | undefined;
export const handleResolverOverride = import.meta.env.PUBLIC_HEDGEROW_HANDLE_RESOLVER as
  | string
  | undefined;
export const plcDirectoryUrlOverride = import.meta.env.PUBLIC_HEDGEROW_PLC_URL as string | undefined;
export const allowHttpOverride = import.meta.env.PUBLIC_HEDGEROW_OAUTH_ALLOW_HTTP === "1";
export const signupServiceOverride = import.meta.env.PUBLIC_HEDGEROW_SIGNUP_SERVICE as
  | string
  | undefined;

// createReader() does no OAuth-client/IndexedDB work until the first actual
// call (see the package README), so a module-level singleton is cheap even
// though this module is also evaluated during Astro's SSR pass for the
// initial HTML.
export const reader = createReader({
  ...(handleResolverOverride ? { handleResolver: handleResolverOverride } : {}),
  ...(plcDirectoryUrlOverride ? { plcDirectoryUrl: plcDirectoryUrlOverride } : {}),
  ...(allowHttpOverride ? { allowHttp: true } : {}),
});
