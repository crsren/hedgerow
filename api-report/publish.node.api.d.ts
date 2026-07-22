// API report for @hedgerow/publish — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

import { Publisher } from "./index.js";
export { BSKY_POST_NSID, BlobRef, DOCUMENT_NSID, DocumentContent, DocumentOptions, DocumentRecord, MARKDOWN_CONTENT_NSID, MarkdownContent, PUBLICATION_NSID, ParsedBskyPostUri, ParsedPost, PublicationConfig, PublicationRecord, PublishOptions, PublishResult, PublishState, ReadSiteOptions, RepoRecord, ResolveBskyPostRefOptions, ResolveHandleOptions, ResolvePdsOptions, ShareOptions, Site, SiteDocument, StrongRef, UnshareResult, VIA_KEY, VIA_VALUE, agentPublisher, documentRecord, emptyState, isRecordNotFound, listRecords, parseBskyPostUri, parsePost, publicationRecord, publishSite, readSite, readSiteFromPds, resolveBskyPostRef, resolveDid, resolvePds, toPlainText, unshare } from "./index.js";
import * as _atproto_oauth_client_node from "@atproto/oauth-client-node";
import "@atproto/api";
interface OAuthPublisherOptions {
    identifier?: string;
    store?: string;
    port?: number;
    openUrl?: (url: string) => void | Promise<void>;
}
interface ClearSessionOptions {
    store?: string;
    identifier?: string;
}
declare function openInBrowser(url: string): void;
declare const loopbackRedirectUri: (port: number) => string;
declare function loopbackClientMetadata(port: number): _atproto_oauth_client_node.AtprotoLoopbackClientMetadata;
declare function oauthPublisher(opts?: OAuthPublisherOptions): Promise<Publisher>;
declare function clearSession(opts?: ClearSessionOptions): Promise<void>;
declare class FileStore<V> {
    private readonly path;
    private data;
    constructor(path: string);
    private static load;
    get(key: string): V | undefined;
    set(key: string, value: V): void;
    del(key: string): void;
    clear(): void;
    keys(): string[];
    private flush;
}
export { type ClearSessionOptions, FileStore, type OAuthPublisherOptions, Publisher, clearSession, clearSession as logout, loopbackClientMetadata, loopbackRedirectUri, oauthPublisher, openInBrowser };
