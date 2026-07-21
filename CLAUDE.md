# Hedgerow — working notes for agents

Four published packages under one scope, version-locked, pre-1.0. Read
`docs/architecture.md` before changing anything structural — the package
boundaries are load-bearing and enforced.

## The rule that costs the most to get wrong

**A published `name@version` is permanent.** It cannot be reused, even after an
unpublish. So a wrong version number is not a bug you fix later — it is a
number burned forever, in public. Everything below exists because of that.

## If you changed anything under `packages/*/src`

Do all three, in this order, before saying the work is done:

1. **Regenerate the API report** — `pnpm api:report`, and commit the result.
   Never hand-edit `api-report/*.api.d.ts`; it is generated from the built
   `.d.ts`. CI fails if it is stale.

2. **Read the API diff you just generated.** This is the evidence for the next
   step, and it is the step agents skip. `git diff api-report/`.
   Note `api-report/behaviour-contract.api.d.ts` covers the typeless half —
   lexicon record shapes, persisted-session paths, the OAuth loopback port, and
   every runtime DEFAULT (thread depth, page sizes, cache TTL, retry delays,
   which AppView is called). Those break users with an unchanged type surface
   and a fully green test suite, so a diff there is breaking even when nothing
   else moved.

   If you add a new module-level default or persisted key, add it to
   `TRACKED_CONSTANTS` in `scripts/behaviour-contract.mjs`. A default that
   isn't tracked is one nothing will notice you changing.

3. **Add a changeset** — `pnpm changeset`.
   - Export removed, renamed, narrowed, or made required → **`minor`**
     (breaking, and pre-1.0 breaking is minor — see below).
   - Purely additive or internal → **`patch`**.
   - **Never `major`.** While the packages are 0.x, Changesets would turn that
     into `1.0.0`, not `0.2.0` — declaring the project stable and burning the
     1.0.0 number. CI rejects it, but don't rely on CI to catch your intent.
   - The summary is the public changelog entry. Write what changed and what a
     consumer must do about it. Not "fix types". Not "misc improvements".

The packages are version-locked, so this is **one** decision for the whole
release, not one per package.

## Don't guess at "is this breaking?"

The API report exists precisely so this is a diff, not a judgement. If the diff
is empty, the surface didn't change. If it isn't, read what moved.

Caveat worth holding: an empty API diff does **not** prove the change is safe.
Behaviour breaks with identical types — a changed default, a different sort
order, a new throw path, a stricter runtime validation. If you changed
behaviour a consumer depends on, that is breaking regardless of what the
report says.

## What you must never do without being asked

- **Publish.** Not `npm publish`, not `pnpm release`, not `changeset publish`.
  Releases happen by merging the "Version Packages" PR. There is no situation
  where an agent should be pushing bytes to the registry on its own initiative.
  A guard (`scripts/assert-publish-context.mjs`) refuses local publishes, and
  **`HEDGEROW_ALLOW_LOCAL_PUBLISH=1` is not yours to set** — it exists solely
  for a human bootstrapping a brand-new package name.
- **`changeset pre enter` / `pre exit`.** Entering prerelease mode changes what
  every subsequent release publishes and which dist-tag it lands on.
- **Edit versions in `package.json` by hand.** Changesets owns those numbers.
- **Edit `.github/workflows/release.yml`, or any package's `publishConfig`,
  `files`, or `exports`.** These decide what reaches npm and who is allowed to
  push it. Changing them is changing the release mechanism itself, and npm's
  trusted publisher is bound to that workflow file by name.
- **Widen a package's dependencies** to cross a boundary
  `docs/architecture.md` forbids (notably: `@hedgerow/react` must never depend
  on `@hedgerow/reader` or `@hedgerow/publish`).

## Verifying your work

```bash
pnpm typecheck && pnpm build && pnpm test
pnpm verify:packaging   # packs real tarballs, proves each import() resolves
pnpm api:check
node scripts/check-changesets.mjs --base origin/main   # changeset + bump policy
```

Without `--base` the changeset check silently skips the presence half and
prints OK — so always pass it, or you will verify nothing.

For a faster inner loop, scope to one package:
`pnpm --filter @hedgerow/react test`.

`pnpm verify:packaging` is the one that catches publishing mistakes the type
checker can't see (raw `src/` shipping, a dropped export condition, a lost
`"use client"`). Run it after touching any `exports` map, `files` array, or
build config.

Full rationale for all of this: `CONTRIBUTING.md`.
