# Package migration

Status: accepted direction; implementation is intentionally staged.

Current implementation: the protocol-correctness foundation is in progress.
The existing packages now carry document/publication CIDs, scope reads to one
publication, expose conditional writes, centralise Markdown document writes
and discussion linking, and reject unknown rich-content formats in editing
paths. Curated `hedgerow/*` entry points have not been introduced yet.

## Objective

Make Hedgerow simple to adopt without exposing raw AT Protocol repository
operations or freezing the current `/sudo` product decisions into a public
editor API.

The public mental model is:

- `hedgerow/site` — publications and documents;
- `hedgerow/social` — public threads/likes and constrained signed-in actions;
- `hedgerow/browser` — browser OAuth lifecycle and scoped sessions;
- `hedgerow/node` — loopback OAuth and Markdown/filesystem synchronisation;
- `@hedgerow/react` — callback-driven social UI;
- `create-hedgerow` — the versioned starter and setup command.

The existing scoped packages remain compatibility surfaces while the curated
`hedgerow/*` API is introduced. They are not re-exported wholesale: raw XRPC,
AppView and generic repository-writer types are implementation details.

## Boundary rule

Package stable protocol invariants; generate customisable product decisions.

Stable protocol invariants include:

- publication membership and record validation;
- TID document identity;
- CID-preserving reads and conditional writes;
- Markdown content plus its plaintext mirror;
- discussion-post creation, linking and compensation;
- least-privilege OAuth scopes and scope upgrades.

Generated product decisions include:

- Tiptap extensions and toolbar;
- the article metadata form;
- IndexedDB draft schema and autosave policy;
- preview, diff and discard presentation;
- URL layout, visual design and hosting-specific cache policy.

There is no public editor, draft, cache or Astro package in the first
migration. An integration becomes a package only after unrelated adopters
converge on the same runtime contract.

## Capability model

Browser OAuth establishes identity and a scoped, opaque transport. It does not
expose arbitrary repository writes.

Feature modules bind a session to constrained operations:

```ts
const session = await browser.restore();
const author = site.author(session, { ownerDid, publication });
await author.updateDocument({ uri, cid, document });

const actor = social.actor(session);
await actor.reply({ root, parent, text });
```

Feature wrappers improve ergonomics and prevent accidental misuse. OAuth
permissions remain the security boundary: author and social sessions request
only the collections/actions they need.

## Compatibility sequence

1. Harden the existing packages without removing exports:
   - retain record CIDs;
   - scope documents to their publication;
   - add conditional create/update/delete using `swapRecord`;
   - centralise TID generation, record construction and discussion linking;
   - reject unknown rich-content members unless conversion is explicit.
2. Add constrained site/social capability factories and granular OAuth scope
   support. Deprecate, but do not yet remove, `Reader.asPublisher()`.
3. Move the portfolio off direct `putRecord` calls and hand-built records.
4. Add the curated `hedgerow/*` entry points. Keep old scoped packages as
   forwarding compatibility packages for at least one minor release.
5. Ship `create-hedgerow` as a tested Astro starter. Generated UX source
   belongs to the adopter and carries a generator-version marker; no automatic
   merge/update promise is made.
6. Deprecate `@hedgerow/react`'s underspecified `Editor.*` only after the
   starter and portfolio no longer consume it.

## Release discipline

- Changesets owns every version and changelog entry; versions are never edited
  by hand.
- Breaking pre-1.0 changes receive a minor bump. Additive compatibility work
  receives a patch bump.
- Every public API change regenerates and reviews the API and behaviour
  reports.
- CI tests packed tarballs, export conditions and consumer imports rather than
  relying only on workspace links.
- Publishing happens only after the Version Packages PR is reviewed and
  merged. GitHub Actions uses npm trusted publishing with provenance; no npm
  token is stored in the repository.
- A bad release is corrected with a new version, dist-tag movement and, when
  useful, deprecation. Published versions are never reused.

`hedgerow` and `create-hedgerow` are already reserved at `0.0.1`. Before their
first automated release from this repository, both npm packages must trust
`crsren/hedgerow`, `.github/workflows/release.yml`, and the `npm-publish`
environment.

## Pull-request plan

Keep changes reviewable and releasable:

1. protocol correctness and tests;
2. constrained capabilities and OAuth permissions;
3. curated entry points and compatibility shims;
4. tested Astro starter;
5. portfolio migration in `crsren/portfolio`.

Each PR must leave the existing packages usable and the repository releasable.
