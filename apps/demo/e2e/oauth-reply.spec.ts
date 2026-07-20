// Reader OAuth login + reply-from-the-browser E2E — currently fixme stubs.
// The UI for this (login button, reply box) lands in a colleague's branch
// (reader-auth); this file documents the steps the real spec will drive once
// it exists, and is deliberately excluded from ../read-path.spec.ts so that
// spec can ship and pass now.
//
// What we've already confirmed works fully locally (see docs/local-testing.md
// for the evidence): @atproto/dev-env's TestPds is a real @atproto/pds
// instance with `devMode: true` and no entryway configured, which means
// `cfg.oauth.provider` is always set (packages/publish's local `resolveDid`/
// `resolvePds` overrides — HEDGEROW_PDS_URL / HEDGEROW_PLC_URL — are the same
// pattern an OAuth client's `handleResolver` / `plcDirectoryUrl` options need).
// So a browser OAuth client pointed at the local PDS as both issuer and
// handle resolver should be able to complete a full PAR -> authorize ->
// password login -> token exchange loop against nothing but this local
// network. What we have NOT yet driven end-to-end is a real browser filling
// in the built-in login form and completing the loopback/postMessage
// redirect — that's blocked on the reply UI existing to test against.
import { test } from "@playwright/test";

test.fixme(
  "reader can log in with their local atproto account via OAuth",
  async ({ page: _page }) => {
    // 1. Seed a third local account in dev-net.mjs (e.g. "carol.test") that
    //    is NOT alice (site owner) or bob (seeded commenter) — a fresh reader.
    // 2. Navigate to the post page and click the (future) "Log in to reply"
    //    button in CommentThread.tsx / the reader-auth component.
    // 3. The OAuth client config must point:
    //      - handleResolver / issuer discovery at HEDGEROW_PDS_URL (the local
    //        PDS is its own OAuth authorization server when no entryway is
    //        configured — see docs/local-testing.md).
    //      - plcDirectoryUrl at HEDGEROW_PLC_URL.
    // 4. On the PDS's own built-in /oauth/authorize page, fill in
    //    "carol.test" + the seeded password and submit.
    // 5. Expect the redirect back to the app with an authenticated session
    //    (e.g. the reply box becomes visible, or a "logged in as carol.test"
    //    indicator appears).
  },
);

test.fixme(
  "logged-in reader can post a reply that appears in the thread",
  async ({ page: _page }) => {
    // 1. Complete the login flow above (or restore a cached OAuth session).
    // 2. Fill in the reply box under the seeded thread and submit.
    // 3. The reply should call com.atproto.repo.createRecord (app.bsky.feed.post,
    //    with reply.parent/root set to the thread's root anchor) against the
    //    reader's own repo on the local PDS.
    // 4. Reload (or wait for optimistic UI) and assert the new reply text is
    //    now visible in the thread — proving a REAL write landed on the local
    //    PDS and the read path (via the AppView shim, same as read-path.spec.ts)
    //    picks it up, with zero live network involved.
  },
);
