# Contributing

## How a release actually reaches npm

Merging to `main` publishes nothing. A PR that changes a package carries a
**changeset** describing the change. On merge, CI collects pending changesets
into a **"Version Packages" PR** with the bumped versions and generated
changelogs. **Merging that PR is the release** — it is the one moment a human
decides to make something public, and the diff in front of you is the exact
version numbers and changelog entries that will ship. Nothing else publishes.

That sentence is only true because of three things outside this file, and it is
worth knowing which: `main` is branch-protected so no commit reaches it except
through a PR; CODEOWNERS covers `.github/` and `scripts/` so the release
mechanism itself can't be changed unreviewed; and `prepublishOnly` refuses to
publish from a laptop. Run `scripts/setup-release-protection.sh` to establish
the first two — until it has run, the release gate is intent rather than fact.

## Adding a changeset

```bash
pnpm changeset
```

Pick the bump, write a summary. The summary becomes the changelog entry that a
stranger reads when deciding whether to upgrade — write it for them, not for
yourself. "fix types" is not a changelog entry.

CI fails a PR that changes `packages/*/src`, a package manifest, or a lexicon
without adding one. If the change genuinely can't affect a consumer, add the
`no-changeset` label.

## Choosing the version bump

All four packages are **version-locked** (`fixed` in `.changeset/config.json`):
they share one version number and release together. So there is exactly one
decision per release — *was anything in this release breaking?* — not four.

### Pre-1.0: breaking is a MINOR bump

| Change | Bump |
| --- | --- |
| Anything a consumer's existing code would notice | `minor` |
| New optional export, new optional field, internals, docs, perf | `patch` |
| — | never `major` |

**Never select `major` while we are on 0.x.** Changesets does *not* implement
SemVer's 0.x rule: `major` on `0.1.0` produces **1.0.0**, not 0.2.0. That would
silently declare the project stable and burn the 1.0.0 version number, which can
never be reused. `scripts/check-changesets.mjs` enforces this in CI.

(This is not a quirk of our setup — npm resolves `^0.1.0` as `>=0.1.0 <0.2.0`,
so a 0.x minor *already behaves* like a major for consumers. The bump is honest.)

### Don't decide from memory — read the API diff

`api-report/*.api.d.ts` is the committed public API surface of every package:
the exact type declarations a consumer can import. CI regenerates it and fails
if it drifts, so **any PR that changes the public surface shows that change as a
diff**.

```bash
pnpm api:report   # regenerate after changing exports; commit the result
pnpm api:check    # what CI runs
```

`api-report/behaviour-contract.api.d.ts` covers what types cannot: lexicon
record shapes (already written into other people's repositories, permanently),
the cached-session path and filenames, and the OAuth loopback port encoded in
the client id. Changing any of those breaks real users while every type stays
identical and every test stays green — so treat a diff there as breaking.

Read that diff before choosing the bump:

- anything in the **behavioural contract** changed → breaking → `minor`
- an export **removed** or **renamed** → breaking → `minor`
- a parameter **narrowed**, a return type **changed**, a field made
  **required** → breaking → `minor`
- purely **added** optional surface → `patch`
- no diff at all → `patch`

Between them the two reports now cover: the type surface, the wire format,
persisted state, and every tracked runtime default. Sort order is covered by
`packages/comments/test/sort.test.ts`.

What still isn't mechanically caught: a **new throw path** or a changed error
condition inside an existing function. Types unchanged, defaults unchanged, and
no snapshot moves. If you change when something throws, that's breaking — and
you are the only thing checking. But a non-empty diff is near-proof that something *is* breaking, and
that is the direction the mistake usually goes.

## Prereleases

To publish something real without it becoming the public version:

```bash
pnpm changeset pre enter next   # releases now publish under the `next` dist-tag
# ... normal changeset + release flow ...
pnpm changeset pre exit         # back to stable
```

Two things to know:

- npm assigns `latest` from the `--tag` flag, **not** from the version string.
  Publishing `0.2.0-next.0` with no tag makes it `latest` for everyone.
  `scripts/assert-dist-tag.mjs` runs as `prepublishOnly` and refuses that.
- Forgetting `pre exit` means every later release silently ships as `next`
  while `latest` rots. Check `.changeset/pre.json` is absent on `main`.

For *your own* iteration, prefer per-commit preview builds over a real
prerelease — they never touch the registry, so they can't burn a version
number or move a tag.

## Before you open a PR

```bash
pnpm typecheck && pnpm build && pnpm test
pnpm verify:packaging   # packs each tarball and proves it resolves
pnpm api:check          # committed API report matches the build
pnpm changeset          # unless nothing consumer-visible changed
```
