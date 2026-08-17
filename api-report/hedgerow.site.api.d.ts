// API report for hedgerow — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

import { SiteAuthorOptions, SiteAuthor } from "@hedgerow/publish";
export { AmbiguousPublicationError, DocumentContent, DocumentRecord, DocumentSnapshot, MarkdownContent, PublicationRecord, ReadSiteOptions, ReadSiteScope, RecordConflictError, Site, SiteAuthor, SiteAuthorDiscussionInput, SiteAuthorDocumentInput, SiteAuthorOptions, SiteAuthorUpdateInput, SiteDocument, StartDiscussionResult, StrongRef, UnknownDocumentContent, UnsupportedDocumentContentError, documentMarkdown, isMarkdownContent, readSite, readSiteFromPds } from "@hedgerow/publish";
import { BrowserSession } from "@hedgerow/reader";
declare const permissionScope: string;
declare function author(session: BrowserSession, options: SiteAuthorOptions): SiteAuthor;
export { author, permissionScope };
