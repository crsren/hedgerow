// The one primitive every part is built on — a faithful port of Base UI's
// `render` prop contract, so the whole library composes the way people already
// expect from Base UI / Radix.
//
// A headless part renders a default element, but the consumer can:
//   - swap the element for another one:      render={<a />}
//   - take full control and spread our props: render={(props, state) => <a {...props} />}
//   - style off component state:             className={(state) => state.blocked ? "x" : "y"}
//                                            style={(state) => ({ ... })}
//   - read runtime state in either form via the `state` argument.
//
// `props` we compute (className, style, data-*, event handlers, children, ref)
// are merged into whatever the consumer supplies, with event handlers chained
// and refs composed — never silently dropped.
import * as React from "react";

/** `className` may be a string or derived from the part's runtime state. */
export type ClassNameProp<State> = string | ((state: State) => string | undefined);

/** `style` may be an object or derived from the part's runtime state. */
export type StyleProp<State> =
  | React.CSSProperties
  | ((state: State) => React.CSSProperties | undefined);

/**
 * Props the library hands to a `render` function: everything to spread onto the
 * consumer's element, plus ref. `ref`/attributes are intentionally loose (the
 * Base UI approach) so `<a {...props} />`, `<span {...props} />`, etc. all
 * type-check — the props flow to whatever element the consumer chose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RenderFnProps = React.HTMLAttributes<any> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref?: React.Ref<any>;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
};

/**
 * The props a part passes to {@link renderElement}: intrinsic attributes for its
 * default element (which vary per tag — `dateTime`, `src`, `href`, …), plus our
 * computed data-* / event handlers / children. Permissive by construction.
 */
export type ElementProps = React.HTMLAttributes<Element> & { [key: string]: unknown };

/**
 * The submit handler React itself declares for these props. React 18 types it
 * as `FormEventHandler`; React 19 introduced a distinct `SubmitEvent` and
 * retyped it as `SubmitEventHandler`. Deriving it here (rather than naming
 * either) keeps `Reply.Root` and `Editor.Root` compiling under both majors —
 * this library's peer range is `^18 || ^19`, and CI tests both.
 */
export type SubmitHandler = NonNullable<ElementProps["onSubmit"]>;

/** The Base-UI-style `render` prop: an element to clone, or a factory. */
export type RenderProp<State> =
  | React.ReactElement
  | ((props: RenderFnProps, state: State) => React.ReactElement);

/** Props shared by every headless part. */
export interface HeadlessProps<State> {
  /** Replace or take control of the rendered element (Base UI `render`). */
  render?: RenderProp<State>;
  /** A class string, or a function of the part's state. */
  className?: ClassNameProp<State>;
  /** A style object, or a function of the part's state. */
  style?: StyleProp<State>;
  children?: React.ReactNode;
}

/** Props common to a headless part rendering intrinsic element `Tag`. */
export type PartProps<State, Tag extends keyof React.JSX.IntrinsicElements> = HeadlessProps<State> &
  Omit<React.ComponentPropsWithoutRef<Tag>, "className" | "style" | "children">;

/** Compose N refs into one callback ref. Nulls are ignored. */
export function mergeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref != null) (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}

type AnyProps = Record<string, unknown>;

// This library's peer range is `^18 || ^19`, and the two majors disagree about
// where an element's ref lives. Resolved once from the running React rather
// than probed per element, so neither major's deprecation getter is touched.
const REACT_19_PLUS = Number.parseInt(React.version, 10) >= 19;

const isEventHandler = (key: string, value: unknown): value is (...args: unknown[]) => void =>
  typeof value === "function" && /^on[A-Z]/.test(key);

/**
 * Chain two handlers for the same event so neither is silently dropped —
 * used by every part that computes an interactive handler (`onClick`, etc.)
 * before handing props to {@link renderElement}, so a consumer-supplied
 * handler (via a plain prop, not just the `render` element-clone form) is
 * chained with — never clobbered by — the part's own computed one. Matches
 * {@link mergeProps}' own chaining order: ours runs first, then theirs.
 */
export function chainHandlers<Args extends unknown[]>(
  ours: ((...args: Args) => void) | undefined,
  theirs: ((...args: Args) => void) | undefined,
): ((...args: Args) => void) | undefined {
  if (!ours) return theirs;
  if (!theirs) return ours;
  return (...args: Args) => {
    ours(...args);
    theirs(...args);
  };
}

/**
 * Merge our computed props into a consumer-supplied element's own props.
 * className concatenates, style shallow-merges, matching event handlers chain
 * (ours first, then theirs), refs compose. Everything else: theirs wins.
 * Explicitly `undefined`-valued props in `theirs` are skipped entirely — e.g.
 * `render={<button onClick={undefined} />}` must not clobber a computed
 * handler (or any other computed prop) the way a real override would.
 */
function mergeProps(ours: AnyProps, theirs: AnyProps, theirRef: React.Ref<unknown>): AnyProps {
  const theirsSet: AnyProps = {};
  for (const [key, value] of Object.entries(theirs)) {
    if (value !== undefined) theirsSet[key] = value;
  }

  const merged: AnyProps = { ...ours, ...theirsSet };

  const ourClass = ours.className as string | undefined;
  const theirClass = theirsSet.className as string | undefined;
  const className = [ourClass, theirClass].filter(Boolean).join(" ");
  if (className) merged.className = className;

  if (ours.style || theirsSet.style) {
    merged.style = { ...(ours.style as object), ...(theirsSet.style as object) };
  }

  for (const key of Object.keys(theirsSet)) {
    const theirHandler = theirsSet[key];
    const ourHandler = ours[key];
    if (isEventHandler(key, theirHandler) && isEventHandler(key, ourHandler)) {
      merged[key] = chainHandlers(
        ourHandler as (...args: unknown[]) => void,
        theirHandler as (...args: unknown[]) => void,
      );
    }
  }

  const ourRef = ours.ref as React.Ref<unknown> | undefined;
  if (ourRef || theirRef) merged.ref = mergeRefs(ourRef, theirRef);

  return merged;
}

export interface RenderElementParams<State> {
  /** The part's current runtime state, passed to every function-form prop. */
  state: State;
  render?: RenderProp<State>;
  className?: ClassNameProp<State>;
  style?: StyleProp<State>;
  ref?: React.Ref<Element>;
  /** data-*, aria-*, children, event handlers, and any intrinsic props. */
  props: ElementProps;
}

/**
 * Resolve a headless part down to a React element, honouring the `render` prop.
 * `defaultTag` is used only when no `render` is given.
 */
export function renderElement<State>(
  defaultTag: keyof React.JSX.IntrinsicElements,
  { state, render, className, style, ref, props }: RenderElementParams<State>,
): React.ReactElement {
  const resolvedClassName = typeof className === "function" ? className(state) : className;
  const resolvedStyle = typeof style === "function" ? style(state) : style;

  const own: AnyProps = { ...props };
  if (resolvedClassName != null) own.className = resolvedClassName;
  if (resolvedStyle != null) own.style = resolvedStyle;
  if (ref != null) own.ref = ref;

  if (typeof render === "function") {
    return render(own as RenderFnProps, state);
  }

  if (React.isValidElement(render)) {
    const element = render as React.ReactElement & { ref?: React.Ref<unknown>; props: AnyProps };
    // Where a consumer's ref lives on an element swapped between React majors,
    // and BOTH majors warn if you read the other one's slot:
    //   React 18 — ref is `element.ref`; reading `element.props.ref` logs
    //              "`ref` is not a prop".
    //   React 19 — ref is `element.props.ref`; `element.ref` became a
    //              deprecation getter logging "Accessing element.ref was
    //              removed in React 19".
    // So `props.ref ?? element.ref` cannot be right: on 18 it always warns
    // (the first read), and on 19 it warns for every element-form `render`
    // that has no ref (props.ref is undefined, so it falls through to the
    // getter). Read only the slot that is real for the running major.
    const theirRef = REACT_19_PLUS
      ? ((element.props.ref as React.Ref<unknown> | undefined) ?? null)
      : (element.ref ?? null);
    return React.cloneElement(
      element,
      // React 19 tightened cloneElement's second parameter to
      // `Partial<P> & Attributes`; a bare `Attributes` cast no longer
      // satisfies it once P is inferred as AnyProps. Valid on 18 too.
      mergeProps(own, element.props, theirRef) as Partial<AnyProps> & React.Attributes,
    );
  }

  return React.createElement(defaultTag, own as React.Attributes);
}

/**
 * Build a `data-*` attribute bag from a state record, dropping `undefined`/`false`
 * and rendering `true` as an empty string (CSS-friendly boolean attributes, the
 * Base UI convention: `[data-loading]` present ⇔ true).
 */
export function dataAttrs(
  state: Record<string, string | number | boolean | undefined>,
): Record<`data-${string}`, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined || value === false) continue;
    out[`data-${key}`] = value === true ? "" : value;
  }
  return out;
}
