# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/crsren/hedgerow/security/advisories/new)
on this repository. That opens a private thread with the maintainers.

Expect an acknowledgement within a few days. This is a small project — there is
no on-call rotation and no SLA, and being honest about that is more useful than
promising a response time nobody staffs.

## What's in scope

These packages handle atproto identity and write records to people's own
repositories, so the parts most worth your attention:

- **`@hedgerow/reader`** — browser OAuth for a site's visitors. Session
  handling, PKCE/DPoP state, and anything that could leak a session across
  origins.
- **`@hedgerow/publish`** — the author's OAuth flow and the loopback callback
  server it runs during login, plus the cached session on disk.
- **Record writing** — anything that could cause a write to the wrong
  repository, the wrong collection, or with attacker-influenced content.
- **Supply chain** — the published tarballs and the release workflow.

Out of scope: vulnerabilities in Bluesky, the AT Protocol itself, or a PDS
implementation. Report those to the relevant project.

## Supported versions

Pre-1.0. Only the latest published version is supported — fixes ship forward as
a new release rather than being backported. Note that while these packages are
on 0.x, a **minor** bump may contain breaking changes (see `CONTRIBUTING.md`).

## Publishing and provenance

Releases are published from CI via npm trusted publishing (OIDC), so no
long-lived npm token exists to be stolen. Published packages carry provenance
attestations linking each tarball to the commit and workflow that built it — if
a tarball claims to be `@hedgerow/*` without provenance, treat it as suspect.
