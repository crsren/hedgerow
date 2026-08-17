import {
  emptyState,
  oauthPublisher,
  publishSite,
  type OAuthPublisherOptions,
  type ParsedPost,
  type PublicationConfig,
  type PublishOptions,
  type PublishResult,
  type PublishState,
} from "@hedgerow/publish/node";

export interface SyncMarkdownOptions {
  auth?: OAuthPublisherOptions;
  publication: PublicationConfig;
  posts: ParsedPost[];
  state?: PublishState;
  publish?: PublishOptions;
}

/** Authenticate, then reconcile parsed Markdown with the author's AT repo. */
export async function syncMarkdown(
  options: SyncMarkdownOptions,
): Promise<PublishResult> {
  const publisher = await oauthPublisher(options.auth);
  return publishSite(
    publisher,
    options.publication,
    options.posts,
    options.state ?? emptyState(),
    options.publish,
  );
}

export {
  clearSession as logout,
  emptyState,
  parsePost as parseMarkdown,
} from "@hedgerow/publish/node";

export type {
  ClearSessionOptions,
  OAuthPublisherOptions,
  ParsedPost,
  PublicationConfig,
  PublishOptions,
  PublishResult,
  PublishState,
  ShareOptions,
} from "@hedgerow/publish/node";
