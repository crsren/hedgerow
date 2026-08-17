// API report for @hedgerow/publish — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

import { ConditionalPublisher } from "./index.js";
export { AmbiguousPublicationError, BSKY_POST_NSID, BlobRef, CreateDocumentInput, DOCUMENT_NSID, DeleteDocumentInput, DeleteRecordOptions, DocumentContent, DocumentOptions, DocumentRecord, DocumentSnapshot, MARKDOWN_CONTENT_NSID, MarkdownContent, MarkdownDocumentInput, PUBLICATION_NSID, ParsedBskyPostUri, ParsedPost, ParsedRecordUri, PublicationConfig, PublicationRecord, PublishOptions, PublishResult, PublishState, Publisher, PublisherRecord, PutRecordOptions, ReadSiteOptions, ReadSiteScope, RecordConflictError, RepoRecord, ResolveBskyPostRefOptions, ResolveHandleOptions, ResolvePdsOptions, SITE_AUTHOR_SCOPE, ShareOptions, Site, SiteAuthor, SiteAuthorDiscussionInput, SiteAuthorDocumentInput, SiteAuthorOptions, SiteAuthorUpdateInput, SiteDocument, StartDiscussionInput, StartDiscussionResult, StrongRef, UnknownDocumentContent, UnshareResult, UnsupportedDocumentContentError, UpdateDocumentInput, VIA_KEY, VIA_VALUE, agentPublisher, createDocument, createSiteAuthor, deleteDocument, documentMarkdown, documentRecord, emptyState, isInvalidSwap, isMarkdownContent, isRecordNotFound, listRecords, markdownDocumentRecord, normalizeDocumentPath, parseBskyPostUri, parsePost, parseRecordUri, publicationRecord, publishSite, readSite, readSiteFromPds, resolveBskyPostRef, resolveDid, resolvePds, startDiscussion, supportsConditionalWrites, toPlainText, unshare, updateDocument } from "./index.js";
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
declare function oauthPublisher(opts?: OAuthPublisherOptions): Promise<ConditionalPublisher>;
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
export { type ClearSessionOptions, ConditionalPublisher, FileStore, type OAuthPublisherOptions, clearSession, clearSession as logout, loopbackClientMetadata, loopbackRedirectUri, oauthPublisher, openInBrowser };
