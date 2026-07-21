// API report for @hedgerow/reader — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

interface OAuthSessionLike {
    readonly did: string;
    fetchHandler(pathname: string, init?: RequestInit): Promise<Response>;
    signOut(): Promise<void>;
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
                        value: Record<string, unknown>;
                    };
                }>;
                deleteRecord(params: {
                    repo: string;
                    collection: string;
                    rkey: string;
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
    putRecord(collection: string, rkey: string, record: Record<string, unknown>): Promise<{
        uri: string;
        cid: string;
    }>;
    getRecord(collection: string, rkey: string): Promise<Record<string, unknown> | null>;
    deleteRecord(collection: string, rkey: string): Promise<void>;
}
interface Reader {
    restore(): Promise<ReaderSession | null>;
    signIn(handle: string, opts?: {
        state?: string;
    }): Promise<never>;
    signUp(service?: string, opts?: {
        state?: string;
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
interface CreateReaderOptions {
    clientId?: string;
    handleResolver?: string;
    plcDirectoryUrl?: string;
    allowHttp?: boolean;
    createClient?(): OAuthClientLike | Promise<OAuthClientLike>;
    createAgent?(session: OAuthSessionLike): AgentLike;
}
declare function createReader(options?: CreateReaderOptions): Reader;
declare const DEFAULT_HANDLE_RESOLVER = "https://public.api.bsky.app";
interface DefaultClientOptions {
    clientId?: string;
    handleResolver?: string;
    plcDirectoryUrl?: string;
    allowHttp?: boolean;
}
declare function createDefaultClient(opts: DefaultClientOptions): Promise<OAuthClientLike>;
declare function createDefaultAgent(session: OAuthSessionLike): AgentLike;
export { type AgentLike, type CreateReaderOptions, type CreateReplyInput, DEFAULT_HANDLE_RESOLVER, type DefaultClientOptions, type OAuthClientLike, type OAuthPrompt, type OAuthSessionLike, type ProfileView, type PublisherLike, type Reader, type ReaderProfile, type ReaderSession, type StrongRef, createDefaultAgent, createDefaultClient, createReader };
