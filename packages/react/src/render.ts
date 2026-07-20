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

const isEventHandler = (key: string, value: unknown): value is (...args: unknown[]) => void =>
  typeof value === "function" && /^on[A-Z]/.test(key);

/**
 * Merge our computed props into a consumer-supplied element's own props.
 * className concatenates, style shallow-merges, matching event handlers chain
 * (ours first, then theirs), refs compose. Everything else: theirs wins.
 */
function mergeProps(ours: AnyProps, theirs: AnyProps, theirRef: React.Ref<unknown>): AnyProps {
  const merged: AnyProps = { ...ours, ...theirs };

  const ourClass = ours.className as string | undefined;
  const theirClass = theirs.className as string | undefined;
  const className = [ourClass, theirClass].filter(Boolean).join(" ");
  if (className) merged.className = className;

  if (ours.style || theirs.style) {
    merged.style = { ...(ours.style as object), ...(theirs.style as object) };
  }

  for (const key of Object.keys(theirs)) {
    const theirHandler = theirs[key];
    const ourHandler = ours[key];
    if (isEventHandler(key, theirHandler) && isEventHandler(key, ourHandler)) {
      merged[key] = (...args: unknown[]) => {
        ourHandler(...args);
        theirHandler(...args);
      };
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
    const element = render as React.ReactElement & { ref?: React.Ref<unknown> };
    return React.cloneElement(
      element,
      mergeProps(own, element.props as AnyProps, element.ref ?? null) as React.Attributes,
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
