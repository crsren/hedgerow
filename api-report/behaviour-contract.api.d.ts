# Behavioural contract — GENERATED, DO NOT EDIT.
#
# Regenerate with `pnpm api:report`. Everything here is a promise to people
# whose data already exists. A change to any line is BREAKING even when the
# type surface is untouched — see scripts/behaviour-contract.mjs.

## Record lexicons (the wire format)

### com.atproto.label.defs   (packages/publish/lexicons/com/atproto/label/defs.json)
  object label
    cid: string (optional)
    cts: string (required)
    exp: string (optional)
    neg: boolean (optional)
    sig: bytes (optional)
    src: string (required)
    uri: string (required)
    val: string (required)
    ver: integer (optional)
  object selfLabel
    val: string (required)
  string labelValue
  object selfLabels
    values: array<ref> (required)
  object labelValueDefinition
    adultOnly: boolean (optional)
    blurs: string (required)
    defaultSetting: string (optional)
    identifier: string (required)
    locales: array<ref> (required)
    severity: string (required)
  object labelValueDefinitionStrings
    description: string (required)
    lang: string (required)
    name: string (required)

### com.atproto.repo.strongRef   (packages/publish/lexicons/com/atproto/repo/strongRef.json)
  object main
    cid: string (required)
    uri: string (required)

### pub.hedgerow.content.markdown   (packages/publish/lexicons/pub/hedgerow/content/markdown.json)
  object main
    blobs: array<blob> (optional)
    markdown: string (required)

### site.standard.document   (packages/publish/lexicons/site/standard/document.json)
  record main (key: tid)
    bskyPostRef: ref -> com.atproto.repo.strongRef (optional)
    content: union (optional)
    contributors: array<ref> (optional)
    coverImage: blob (optional)
    description: string (optional)
    labels: union (optional)
    links: union (optional)
    path: string (optional)
    publishedAt: string (required)
    site: string (required)
    tags: array<string> (optional)
    textContent: string (optional)
    title: string (required)
    updatedAt: string (optional)
  object contributor
    did: string (required)
    displayName: string (optional)
    role: string (optional)

### site.standard.publication   (packages/publish/lexicons/site/standard/publication.json)
  record main (key: tid)
    basicTheme: ref -> site.standard.theme.basic (optional)
    description: string (optional)
    icon: blob (optional)
    labels: union (optional)
    name: string (required)
    preferences: ref -> #preferences (optional)
    url: string (required)
  object preferences
    showInDiscover: boolean (optional)

### site.standard.theme.basic   (packages/publish/lexicons/site/standard/theme/basic.json)
  record main (key: tid)
    accent: union (required)
    accentForeground: union (required)
    background: union (required)
    foreground: union (required)

### site.standard.theme.color   (packages/publish/lexicons/site/standard/theme/color.json)
  object rgb
    b: integer (required)
    g: integer (required)
    r: integer (required)
  object rgba
    a: integer (required)
    b: integer (required)
    g: integer (required)
    r: integer (required)

## Persisted state and identity constants

### packages/publish/src/oauth.ts — cached session location + the client id's encoded port
  ATPROTO_SCOPE = "atproto transition:generic"
  DEFAULT_PORT = 4139
  DEFAULT_STORE_DIR = join(homedir(), ".config", "hedgerow")
  STATE_FILE = "oauth-state.json"
  SESSION_FILE = "oauth-session.json"

### packages/publish/src/types.ts — record collection names (the addresses records live at) and the tool-attribution stamp written into every document
  DOCUMENT_NSID = "site.standard.document" as const
  PUBLICATION_NSID = "site.standard.publication" as const
  MARKDOWN_CONTENT_NSID = "pub.hedgerow.content.markdown" as const
  VIA_KEY = "pub.hedgerow.via" as const
  VIA_VALUE = "@hedgerow/publish" as const

### packages/publish/src/read.ts — which third-party services an unconfigured read path talks to
  DEFAULT_RESOLVE_HANDLE_SERVICE = "https://public.api.bsky.app"
  DEFAULT_PLC_URL = "https://plc.directory"

### packages/comments/src/thread.ts — how deep a thread renders when the caller says nothing
  DEFAULT_MAX_DEPTH = 10
  MAX_SUPPORTED_DEPTH = 1000

### packages/comments/src/likes.ts — how many likes get fetched — caps what consumers see
  DEFAULT_PAGE_SIZE = 100
  DEFAULT_MAX_PAGES = 5

### packages/comments/src/resolve.ts — how long a resolved post stays cached
  DEFAULT_CACHE_TTL_MS = 5 * 60_000

### packages/comments/src/xrpc.ts — which AppView an unconfigured read hits, and what it reads
  DEFAULT_APPVIEW = "https://public.api.bsky.app"
  POST_COLLECTION = "app.bsky.feed.post"

### packages/react/src/useComments.ts — optimistic-reply retry timing consumers build UI around
  DEFAULT_CONFIRM_RETRY_DELAYS = [2000, 4000, 6000]
  CONFIRMED_FLASH_MS = 1200

### packages/reader/src/reader.ts — OAuth scope requested of the visitor, and where signup lands
  ATPROTO_SCOPE = "atproto transition:generic"
  DEFAULT_SIGNUP_SERVICE = "https://bsky.social"
  LIKE_COLLECTION = "app.bsky.feed.like"

