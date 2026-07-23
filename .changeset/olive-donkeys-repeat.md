---
"@hedgerow/comments": minor
"@hedgerow/publish": minor
"@hedgerow/react": minor
"@hedgerow/reader": minor
---

Stamp published documents with tool attribution (`pub.hedgerow.via`)

Every `site.standard.document` written by `publishSite` now carries an extra
field, `"pub.hedgerow.via": "@hedgerow/publish"`, so a reader can tell
hedgerow-published documents apart from any other standard.site producer.
`VIA_KEY` and `VIA_VALUE` are exported to filter on without hardcoding strings.

The field is not part of the standard.site lexicon. It rides along as an
unknown field, which the protocol carries rather than strips — PDSes don't
validate against lexicons, and the lexicon spec says consumers should ignore
fields they don't recognise. Readers that don't know it are unaffected. The key
is reverse-DNS rather than a bare `via` because atproto has no convention for
third-party extra keys, and `via` is the name standard.site would most likely
choose if it ever adds attribution of its own.

**Upgrading rewrites your existing documents once.** `publishSite` decides
whether to write by comparing the record it builds against the live one, so on
the first publish after this upgrade every already-published document differs
(it lacks the stamp) and is rewritten with `updatedAt` set to now — including
posts you haven't touched. A site that displays "last updated" will show
today's date on everything, once. Subsequent publishes are no-ops again: the
stamp is a constant and deliberately carries no version, precisely so that
upgrading hedgerow never churns records again.

If that one-time bump matters for your site, publish once immediately after
upgrading and before your next content change, so the two aren't conflated.
