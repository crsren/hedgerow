// API report for hedgerow — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

import { OAuthPublisherOptions, PublicationConfig, ParsedPost, PublishState, PublishOptions, PublishResult } from "@hedgerow/publish/node";
export { ClearSessionOptions, OAuthPublisherOptions, ParsedPost, PublicationConfig, PublishOptions, PublishResult, PublishState, ShareOptions, emptyState, clearSession as logout, parsePost as parseMarkdown } from "@hedgerow/publish/node";
interface SyncMarkdownOptions {
    auth?: OAuthPublisherOptions;
    publication: PublicationConfig;
    posts: ParsedPost[];
    state?: PublishState;
    publish?: PublishOptions;
}
declare function syncMarkdown(options: SyncMarkdownOptions): Promise<PublishResult>;
export { type SyncMarkdownOptions, syncMarkdown };
