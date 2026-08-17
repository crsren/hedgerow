// API report for @hedgerow/publish — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

import { Agent } from "@atproto/api";
declare const PUBLICATION_NSID: "site.standard.publication";
declare const DOCUMENT_NSID: "site.standard.document";
declare const BSKY_POST_NSID: "app.bsky.feed.post";
declare const MARKDOWN_CONTENT_NSID: "pub.hedgerow.content.markdown";
declare const VIA_KEY: "pub.hedgerow.via";
declare const VIA_VALUE: "@hedgerow/publish";
interface StrongRef {
    uri: string;
    cid: string;
}
interface BlobRef {
    $type: "blob";
    ref: {
        $link: string;
    };
    mimeType: string;
    size: number;
}
interface MarkdownContent {
    $type: typeof MARKDOWN_CONTENT_NSID;
    markdown: string;
    blobs?: BlobRef[];
}
interface UnknownDocumentContent {
    $type: string;
    [key: string]: unknown;
}
type DocumentContent = MarkdownContent | UnknownDocumentContent;
declare function isMarkdownContent(content: unknown): content is MarkdownContent;
declare class UnsupportedDocumentContentError extends Error {
    readonly contentType: string;
    constructor(contentType: string);
}
declare function documentMarkdown(document: DocumentRecord): string | null;
interface PublicationRecord {
    $type: typeof PUBLICATION_NSID;
    url: string;
    name: string;
    description?: string;
}
interface DocumentRecord {
    $type: typeof DOCUMENT_NSID;
    site: string;
    title: string;
    publishedAt: string;
    path?: string;
    description?: string;
    tags?: string[];
    updatedAt?: string;
    content?: DocumentContent;
    textContent?: string;
    bskyPostRef?: StrongRef;
    [VIA_KEY]?: typeof VIA_VALUE;
}
interface PublicationConfig {
    url: string;
    name: string;
    description?: string;
}
interface ParsedPost {
    slug: string;
    path?: string;
    title: string;
    publishedAt: string;
    description?: string;
    tags?: string[];
    draft?: boolean;
    share?: boolean;
    body: string;
    bskyPostRef?: StrongRef;
    bskyPostUri?: string;
}
declare function parsePost(markdown: string, fallbackSlug: string): ParsedPost;
declare function publicationRecord(config: PublicationConfig): PublicationRecord;
declare function toPlainText(markdown: string): string;
declare function normalizeDocumentPath(path: string): string;
interface MarkdownDocumentInput {
    site: string;
    title: string;
    publishedAt: string;
    path?: string;
    description?: string;
    tags?: string[];
    markdown: string;
    bskyPostRef?: StrongRef;
    updatedAt?: string;
}
declare function markdownDocumentRecord(input: MarkdownDocumentInput): DocumentRecord;
interface DocumentOptions {
    siteUri: string;
    updatedAt?: string;
}
declare function documentRecord(post: ParsedPost, opts: DocumentOptions): DocumentRecord;
interface PublisherRecord<T = Record<string, unknown>> {
    uri: string;
    cid: string;
    value: T;
}
interface PutRecordOptions {
    swapRecord?: string | null;
}
interface DeleteRecordOptions {
    swapRecord?: string;
}
interface Publisher {
    did: string;
    putRecord(collection: string, rkey: string, record: Record<string, unknown>, options?: PutRecordOptions): Promise<{
        uri: string;
        cid: string;
    }>;
    getRecord(collection: string, rkey: string): Promise<Record<string, unknown> | null>;
    deleteRecord(collection: string, rkey: string, options?: DeleteRecordOptions): Promise<void>;
}
interface ConditionalPublisher extends Publisher {
    readonly supportsSwapRecord: true;
    getRecordWithCid(collection: string, rkey: string): Promise<PublisherRecord | null>;
}
declare class RecordConflictError extends Error {
    readonly expectedCid: string | null;
    constructor(message: string, expectedCid: string | null, options?: ErrorOptions);
}
declare function isRecordNotFound(err: unknown): boolean;
declare function isInvalidSwap(err: unknown): boolean;
declare function supportsConditionalWrites(publisher: Publisher): publisher is ConditionalPublisher;
declare function agentPublisher(agent: Agent): ConditionalPublisher;
type DocumentSnapshot = PublisherRecord<DocumentRecord>;
interface ParsedRecordUri {
    did: string;
    collection: string;
    rkey: string;
}
declare function parseRecordUri(uri: string): ParsedRecordUri;
type CreateDocumentInput = MarkdownDocumentInput;
declare function createDocument(publisher: ConditionalPublisher, input: CreateDocumentInput): Promise<DocumentSnapshot>;
interface UpdateDocumentInput {
    uri: string;
    cid: string;
    document: Omit<MarkdownDocumentInput, "updatedAt">;
}
declare function updateDocument(publisher: ConditionalPublisher, input: UpdateDocumentInput): Promise<DocumentSnapshot>;
interface DeleteDocumentInput {
    uri: string;
    cid: string;
}
declare function deleteDocument(publisher: ConditionalPublisher, input: DeleteDocumentInput): Promise<void>;
interface StartDiscussionInput {
    document: DocumentSnapshot;
    canonicalUrl: string;
    text?: string;
}
interface StartDiscussionResult {
    document: DocumentSnapshot;
    post: StrongRef;
}
declare function startDiscussion(publisher: ConditionalPublisher, input: StartDiscussionInput): Promise<StartDiscussionResult>;
interface ResolveBskyPostRefOptions {
    pds?: string;
    fetchImpl?: typeof fetch;
}
interface ParsedBskyPostUri {
    authority: string;
    rkey: string;
}
declare function parseBskyPostUri(uriOrUrl: string): ParsedBskyPostUri;
declare function resolveBskyPostRef(uriOrUrl: string, opts?: ResolveBskyPostRefOptions): Promise<StrongRef>;
interface PublishState {
    publication: string | null;
    docs: Record<string, string>;
    shares: Record<string, StrongRef>;
}
declare const emptyState: () => PublishState;
interface PublishResult {
    publicationUri: string;
    documents: {
        slug: string;
        uri: string;
        title: string;
        changed: boolean;
    }[];
    state: PublishState;
    warnings: string[];
    pruned: string[];
    skipped: string[];
}
interface ShareOptions {
    enabled: true;
    text?: (post: ParsedPost, url: string) => string;
}
interface PublishOptions {
    resolveOpts?: ResolveBskyPostRefOptions;
    share?: ShareOptions;
    prune?: boolean;
}
declare function publishSite(publisher: Publisher, config: PublicationConfig, posts: ParsedPost[], state?: PublishState, options?: PublishOptions): Promise<PublishResult>;
interface UnshareResult {
    state: PublishState;
    removed: boolean;
    warnings: string[];
}
declare function unshare(publisher: Publisher, slug: string, state: PublishState): Promise<UnshareResult>;
interface RepoRecord<T> {
    uri: string;
    cid: string;
    value: T;
}
declare function listRecords<T>(pds: string, repo: string, collection: string, fetchImpl?: typeof fetch): Promise<RepoRecord<T>[]>;
interface ResolveHandleOptions {
    service?: string;
}
declare function resolveDid(identifier: string, fetchImpl?: typeof fetch, opts?: ResolveHandleOptions): Promise<string>;
interface ResolvePdsOptions extends ResolveHandleOptions {
    plcUrl?: string;
}
declare function resolvePds(identifier: string, fetchImpl?: typeof fetch, opts?: ResolvePdsOptions): Promise<{
    did: string;
    pds: string;
}>;
interface SiteDocument {
    uri: string | null;
    cid: string | null;
    value: DocumentRecord;
}
interface Site {
    publication: PublicationRecord | null;
    publicationUri: string | null;
    publicationCid: string | null;
    documents: SiteDocument[];
}
interface ReadSiteScope {
    publicationUri?: string;
    publicationUrl?: string;
}
declare class AmbiguousPublicationError extends Error {
    readonly publications: string[];
    constructor(publications: string[]);
}
declare function readSiteFromPds(pds: string, did: string, fetchImpl?: typeof fetch, scope?: ReadSiteScope): Promise<Site>;
interface ReadSiteOptions extends ResolvePdsOptions, ReadSiteScope {
    pds?: string;
}
declare function readSite(identifier: string, fetchImpl?: typeof fetch, opts?: ReadSiteOptions): Promise<Site>;
export { AmbiguousPublicationError, BSKY_POST_NSID, type BlobRef, type ConditionalPublisher, type CreateDocumentInput, DOCUMENT_NSID, type DeleteDocumentInput, type DeleteRecordOptions, type DocumentContent, type DocumentOptions, type DocumentRecord, type DocumentSnapshot, MARKDOWN_CONTENT_NSID, type MarkdownContent, type MarkdownDocumentInput, PUBLICATION_NSID, type ParsedBskyPostUri, type ParsedPost, type ParsedRecordUri, type PublicationConfig, type PublicationRecord, type PublishOptions, type PublishResult, type PublishState, type Publisher, type PublisherRecord, type PutRecordOptions, type ReadSiteOptions, type ReadSiteScope, RecordConflictError, type RepoRecord, type ResolveBskyPostRefOptions, type ResolveHandleOptions, type ResolvePdsOptions, type ShareOptions, type Site, type SiteDocument, type StartDiscussionInput, type StartDiscussionResult, type StrongRef, type UnknownDocumentContent, type UnshareResult, UnsupportedDocumentContentError, type UpdateDocumentInput, VIA_KEY, VIA_VALUE, agentPublisher, createDocument, deleteDocument, documentMarkdown, documentRecord, emptyState, isInvalidSwap, isMarkdownContent, isRecordNotFound, listRecords, markdownDocumentRecord, normalizeDocumentPath, parseBskyPostUri, parsePost, parseRecordUri, publicationRecord, publishSite, readSite, readSiteFromPds, resolveBskyPostRef, resolveDid, resolvePds, startDiscussion, supportsConditionalWrites, toPlainText, unshare, updateDocument };
