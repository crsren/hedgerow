// @hedgerow/reader — browser-side reader identity for Bluesky comments:
// atproto OAuth login (via @atproto/oauth-client-browser) and writing a reply
// post to the reader's own PDS. Framework-agnostic (no React) so
// @hedgerow/react stays dependency-light; a consumer wires the two together.
export { createReader } from "./reader.js";
export type { CreateReaderOptions } from "./reader.js";

export { DEFAULT_HANDLE_RESOLVER, createDefaultClient, createDefaultAgent } from "./default-client.js";
export type { DefaultClientOptions } from "./default-client.js";

export type { AgentLike, OAuthClientLike, OAuthPrompt, OAuthSessionLike, ProfileView } from "./client-types.js";

export {
  browserSessionAgent,
  createBrowser,
  publisherForSession,
} from "./browser.js";
export type {
  BrowserAuth,
  BrowserAuthorizationOptions,
  BrowserSession,
  CreateBrowserOptions,
} from "./browser.js";

export { createSocialActor } from "./social.js";
export type { SocialActor } from "./social.js";

export {
  BLUESKY_PROFILE_SCOPE,
  IDENTITY_SCOPE,
  LEGACY_GENERIC_SCOPE,
  SOCIAL_SCOPE,
  combineScopes,
} from "./scopes.js";

export type {
  CreateReplyInput,
  PublisherLike,
  Reader,
  ReaderProfile,
  ReaderSession,
  StrongRef,
} from "./types.js";
