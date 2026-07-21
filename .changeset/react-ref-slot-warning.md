---
"@hedgerow/react": patch
---

Stop emitting React's ref-slot warning, and actually support the React 19 half of the declared peer range.

`renderElement` read both `element.props.ref` and `element.ref` when cloning a `render` element. Each React major turns the *other* slot into a warning: React 18 logs "`ref` is not a prop" (this was firing in every consumer that used the element form of `render`), and React 19 logs "Accessing element.ref was removed". It now reads only the slot that is real for the running major.

The package has always declared `react: ^18 || ^19` but was only ever built and tested against 18. Testing 19 surfaced three more type-level breaks, all now fixed: `onSubmit` (React 19 introduced a distinct `SubmitEvent` type), `cloneElement`'s tightened second parameter, and a callback ref whose return value React 19 reads as a cleanup function.

No API change — the same components, props and types as before.
