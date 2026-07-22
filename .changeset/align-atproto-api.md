---
"@hedgerow/publish": patch
---

Align the `@atproto/api` range on `^0.20.31` across the packages that depend on it.

`@hedgerow/publish` asked for `^0.20.0` while `@hedgerow/reader` asked for `^0.20.30`, which let a consumer's tree end up with two copies of the SDK — and `@atproto/api` carries the atproto identity and session types both packages exchange, so two copies is a real hazard rather than just wasted bytes.

No API change. The new floor is a version already published inside the previously-declared range, so nothing that worked before stops working.
