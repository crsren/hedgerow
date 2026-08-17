import {
  createSiteAuthor,
  SITE_AUTHOR_SCOPE,
  type SiteAuthor,
  type SiteAuthorOptions,
} from "@hedgerow/publish";
import {
  publisherForSession,
  type BrowserSession,
} from "@hedgerow/reader";

/** Maximum OAuth permissions needed by the publication editor. */
export const permissionScope = SITE_AUTHOR_SCOPE;

/** Bind a signed-in browser session to one owner's one publication. */
export function author(
  session: BrowserSession,
  options: SiteAuthorOptions,
): SiteAuthor {
  return createSiteAuthor(publisherForSession(session), options);
}

export {
  AmbiguousPublicationError,
  RecordConflictError,
  UnsupportedDocumentContentError,
  documentMarkdown,
  isMarkdownContent,
  readSite,
  readSiteFromPds,
} from "@hedgerow/publish";

export type {
  DocumentContent,
  DocumentRecord,
  DocumentSnapshot,
  MarkdownContent,
  PublicationRecord,
  ReadSiteOptions,
  ReadSiteScope,
  Site,
  SiteAuthor,
  SiteAuthorDiscussionInput,
  SiteAuthorDocumentInput,
  SiteAuthorOptions,
  SiteAuthorUpdateInput,
  SiteDocument,
  StartDiscussionResult,
  StrongRef,
  UnknownDocumentContent,
} from "@hedgerow/publish";
