---
"@hedgerow/publish": patch
---

Declare `@atproto/common-web` at `^0.5.6`, matching what `@atproto/api` already requires.

The old `^0.4.0` range meant every consumer installed **two** copies of the package: 0.4.21 for this direct dependency and 0.5.6 pulled in by `@atproto/api`. Now there is one.

Record key generation is unchanged. `TID` output was compared across both versions over 200 generated keys with zero differences, and 0.5.6 parses keys produced by 0.4.21 — so existing `.publish-state.json` files stay valid and republishing remains idempotent against records already in your repo.

No API change, and no new constraint on consumers: the ESM-only, Node >= 22 floor that 0.5 introduces was already imposed by the existing `@atproto/api` dependency.
