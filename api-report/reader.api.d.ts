// API report for @hedgerow/reader — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

interface OAuthSessionLike {
    readonly did: string;
    fetchHandler(pathname: string, init?: RequestInit): Promise<Response>;
    signOut(): Promise<void>;
    getTokenInfo?(): Promise<{
        scope: string;
    }>;
}
type OAuthPrompt = "none" | "login" | "consent" | "select_account" | "create";
interface OAuthClientLike {
    init(): Promise<{
        session: OAuthSessionLike;
        state?: string | null;
    } | undefined>;
    signIn(input: string, options?: {
        scope?: string;
        prompt?: OAuthPrompt;
        state?: string;
        signal?: AbortSignal;
    }): Promise<OAuthSessionLike>;
}
interface ProfileView {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
}
interface RecordListItem {
    uri: string;
    cid: string;
    value: Record<string, unknown>;
}
interface ListOwnRecordsParams {
    collection: string;
    limit?: number;
    cursor?: string;
    reverse?: boolean;
}
interface ListOwnRecordsResult {
    records: RecordListItem[];
    cursor?: string;
}
interface AgentLike {
    getProfile(params: {
        actor: string;
    }): Promise<{
        data: ProfileView;
    }>;
    post(record: Record<string, unknown>): Promise<{
        uri: string;
        cid: string;
    }>;
    com?: {
        atproto: {
            repo: {
                putRecord(params: {
                    repo: string;
                    collection: string;
                    rkey: string;
                    record: Record<string, unknown>;
                    swapRecord?: string | null;
                }): Promise<{
                    data: {
                        uri: string;
                        cid: string;
                    };
                }>;
                getRecord(params: {
                    repo: string;
                    collection: string;
                    rkey: string;
                }): Promise<{
                    data: {
                        uri: string;
                        cid?: string;
                        value: Record<string, unknown>;
                    };
                }>;
                deleteRecord(params: {
                    repo: string;
                    collection: string;
                    rkey: string;
                    swapRecord?: string;
                }): Promise<unknown>;
            };
        };
    };
    like(uri: string, cid: string): Promise<{
        uri: string;
        cid: string;
    }>;
    deleteLike(likeUri: string): Promise<void>;
    listOwnRecords(params: ListOwnRecordsParams): Promise<ListOwnRecordsResult>;
}
interface StrongRef {
    uri: string;
    cid: string;
}
interface ReaderSession {
    did: string;
    handle: string;
    displayName?: string;
}
interface ReaderProfile extends ReaderSession {
    avatar?: string;
}
interface CreateReplyInput {
    root: StrongRef;
    parent: StrongRef;
    text: string;
}
interface PublisherLike {
    did: string;
    readonly supportsSwapRecord: true;
    putRecord(collection: string, rkey: string, record: Record<string, unknown>, options?: {
        swapRecord?: string | null;
    }): Promise<{
        uri: string;
        cid: string;
    }>;
    getRecord(collection: string, rkey: string): Promise<Record<string, unknown> | null>;
    getRecordWithCid(collection: string, rkey: string): Promise<{
        uri: string;
        cid: string;
        value: Record<string, unknown>;
    } | null>;
    deleteRecord(collection: string, rkey: string, options?: {
        swapRecord?: string;
    }): Promise<void>;
}
interface Reader {
    restore(): Promise<ReaderSession | null>;
    signIn(handle: string, opts?: {
        state?: string;
        scope?: string;
    }): Promise<never>;
    signUp(service?: string, opts?: {
        state?: string;
        scope?: string;
    }): Promise<never>;
    signOut(): Promise<void>;
    getProfile(): Promise<ReaderProfile | null>;
    createReply(input: CreateReplyInput): Promise<StrongRef>;
    asPublisher(): PublisherLike;
    like(subject: StrongRef): Promise<StrongRef>;
    unlike(likeUri: string): Promise<void>;
    findLike(subjectUri: string): Promise<string | null>;
    takeCallbackState(): string | null;
}
interface BrowserSession {
    readonly did: string;
    readonly handle: string;
    readonly displayName?: string;
    readonly scope: string;
}
interface CreateBrowserOptions {
    clientId?: string;
    scope?: string;
    handleResolver?: string;
    plcDirectoryUrl?: string;
    allowHttp?: boolean;
    createClient?(): OAuthClientLike | Promise<OAuthClientLike>;
    createAgent?(session: OAuthSessionLike): AgentLike;
}
interface BrowserAuthorizationOptions {
    state?: string;
    scope?: string;
}
interface BrowserAuth {
    restore(): Promise<BrowserSession | null>;
    signIn(handle: string, options?: BrowserAuthorizationOptions): Promise<never>;
    signUp(service?: string, options?: BrowserAuthorizationOptions): Promise<never>;
    signOut(): Promise<void>;
    getProfile(): Promise<ReaderProfile | null>;
    takeCallbackState(): string | null;
}
declare function browserSessionAgent(session: BrowserSession): AgentLike;
declare function publisherForSession(session: BrowserSession): PublisherLike;
declare function createBrowser(options?: CreateBrowserOptions): BrowserAuth;
interface CreateReaderOptions extends CreateBrowserOptions {
    scope?: string;
}
declare function createReader(options?: CreateReaderOptions): Reader;
declare const DEFAULT_HANDLE_RESOLVER = "https://public.api.bsky.app";
interface DefaultClientOptions {
    clientId?: string;
    scope?: string;
    handleResolver?: string;
    plcDirectoryUrl?: string;
    allowHttp?: boolean;
}
declare function createDefaultClient(opts: DefaultClientOptions): Promise<OAuthClientLike>;
declare function createDefaultAgent(session: OAuthSessionLike): AgentLike;
interface SocialActor {
    readonly did: string;
    createReply(input: CreateReplyInput): Promise<StrongRef>;
    like(subject: StrongRef): Promise<StrongRef>;
    unlike(likeUri: string): Promise<void>;
    findLike(subjectUri: string): Promise<string | null>;
}
declare function createSocialActor(session: BrowserSession): SocialActor;
declare const IDENTITY_SCOPE = "atproto";
declare const BLUESKY_PROFILE_SCOPE = "rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview";
declare const SOCIAL_SCOPE: string;
declare const LEGACY_GENERIC_SCOPE = "atproto transition:generic";
declare function combineScopes(...scopes: Array<string | undefined>): string;
export { type AgentLike, BLUESKY_PROFILE_SCOPE, type BrowserAuth, type BrowserAuthorizationOptions, type BrowserSession, type CreateBrowserOptions, type CreateReaderOptions, type CreateReplyInput, DEFAULT_HANDLE_RESOLVER, type DefaultClientOptions, IDENTITY_SCOPE, LEGACY_GENERIC_SCOPE, type OAuthClientLike, type OAuthPrompt, type OAuthSessionLike, type ProfileView, type PublisherLike, type Reader, type ReaderProfile, type ReaderSession, SOCIAL_SCOPE, type SocialActor, type StrongRef, browserSessionAgent, combineScopes, createBrowser, createDefaultAgent, createDefaultClient, createReader, createSocialActor, publisherForSession };
