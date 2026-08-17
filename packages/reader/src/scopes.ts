/** Identity-only OAuth. This is the safe base for a browser session. */
export const IDENTITY_SCOPE = "atproto";

/** Read the signed-in actor's Bluesky profile through the public AppView. */
export const BLUESKY_PROFILE_SCOPE =
  "rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview";

/**
 * Reply and like permissions used by Hedgerow's social UI. Replies are
 * Bluesky posts; likes are their own records and need create/delete so the
 * button can be toggled back off.
 */
export const SOCIAL_SCOPE = [
  IDENTITY_SCOPE,
  BLUESKY_PROFILE_SCOPE,
  "repo:app.bsky.feed.post?action=create",
  "repo:app.bsky.feed.like?action=create&action=delete",
].join(" ");

/**
 * Compatibility scope used by @hedgerow/reader before granular AT Protocol
 * permissions were available. New integrations should use SOCIAL_SCOPE (or
 * a feature-specific scope assembled with combineScopes) instead.
 */
export const LEGACY_GENERIC_SCOPE = "atproto transition:generic";

/** Join scope strings without asking for the same permission twice. */
export function combineScopes(...scopes: Array<string | undefined>): string {
  const unique = new Set<string>();
  for (const scope of scopes) {
    for (const permission of scope?.trim().split(/\s+/) ?? []) {
      if (permission) unique.add(permission);
    }
  }
  return [...unique].join(" ");
}
