// Direct unit coverage for the render primitive every part is built on. The
// component tests exercise it indirectly; here we pin the contract itself —
// mergeRefs composition, and renderElement's three forms (default tag, function
// render, element clone) with class concat, style merge, handler chaining, and
// ref composition.
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderElement, mergeRefs, dataAttrs, type RenderElementParams } from "../src/render";

/** Thin component wrapper so we can render a renderElement() result into the DOM. */
function Probe({
  tag,
  params,
}: {
  tag: keyof React.JSX.IntrinsicElements;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: RenderElementParams<any>;
}) {
  return renderElement(tag, params);
}

describe("mergeRefs", () => {
  it("composes callback and object refs and ignores null/undefined", () => {
    const calls: string[] = [];
    const fnRef = (v: string | null) => calls.push(`fn:${v}`);
    const objRef: React.MutableRefObject<string | null> = { current: null };

    const merged = mergeRefs<string>(fnRef, objRef, null, undefined);
    merged("X");

    expect(calls).toEqual(["fn:X"]);
    expect(objRef.current).toBe("X");
  });
});

describe("dataAttrs", () => {
  it("drops undefined/false, renders true as empty string, passes values through", () => {
    expect(
      dataAttrs({ loading: true, empty: false, count: 3, label: "x", missing: undefined }),
    ).toEqual({ "data-loading": "", "data-count": 3, "data-label": "x" });
  });
});

describe("renderElement — default tag form", () => {
  it("creates the default element with computed className, style, and props", () => {
    const { container } = render(
      <Probe
        tag="span"
        params={{
          state: {},
          className: "c",
          style: { color: "red" },
          props: { "data-x": "1", children: "hi" },
        }}
      />,
    );
    const span = container.querySelector("span")!;
    expect(span.className).toBe("c");
    expect(span.getAttribute("data-x")).toBe("1");
    expect(span.textContent).toBe("hi");
    expect(span.style.color).toBe("red");
  });
});

describe("renderElement — function form", () => {
  it("calls the render function with resolved (state-derived) className/style", () => {
    const { getByTestId } = render(
      <Probe
        tag="div"
        params={{
          state: { blocked: true },
          className: (s: { blocked: boolean }) => (s.blocked ? "blk" : "ok"),
          style: (s: { blocked: boolean }) => ({ color: s.blocked ? "red" : "green" }),
          props: { children: "x" },
          render: (props, state: { blocked: boolean }) => (
            <a {...props} data-testid="fn" data-blocked={String(state.blocked)}>
              {props.children}
            </a>
          ),
        }}
      />,
    );
    const a = getByTestId("fn");
    expect(a.tagName).toBe("A");
    expect(a.className).toBe("blk"); // className function resolved before hand-off
    expect(a.getAttribute("data-blocked")).toBe("true");
    expect((a as HTMLElement).style.color).toBe("red");
  });
});

describe("renderElement — element (clone) form", () => {
  it("merges class/style, chains handlers ours-first, and composes refs", () => {
    const order: string[] = [];
    const ourClick = () => order.push("ours");
    const theirClick = () => order.push("theirs");
    const objRef: React.MutableRefObject<HTMLButtonElement | null> = { current: null };
    const theirRef: React.MutableRefObject<HTMLButtonElement | null> = { current: null };

    const { container } = render(
      <Probe
        tag="button"
        params={{
          state: {},
          className: "ours",
          style: { color: "red", margin: "1px" },
          ref: objRef,
          props: { onClick: ourClick, type: "button", children: "click" },
          render: (
            <button
              className="theirs"
              style={{ color: "blue" }}
              onClick={theirClick}
              ref={theirRef}
            />
          ),
        }}
      />,
    );

    const btn = container.querySelector("button")!;
    // className concatenates, ours first.
    expect(btn.className).toBe("ours theirs");
    // style shallow-merges; on a key conflict theirs wins, ours-only survives.
    expect(btn.style.color).toBe("blue");
    expect(btn.style.margin).toBe("1px");
    expect(btn.textContent).toBe("click");
    // both refs got the node.
    expect(objRef.current).toBe(btn);
    expect(theirRef.current).toBe(btn);
    // matching handlers chain: ours runs before theirs.
    btn.click();
    expect(order).toEqual(["ours", "theirs"]);
  });

  it("keeps a consumer handler even when the part supplies none for that event", () => {
    let clicked = false;
    const { container } = render(
      <Probe
        tag="button"
        params={{
          state: {},
          props: { children: "x" },
          render: <button onClick={() => (clicked = true)} />,
        }}
      />,
    );
    container.querySelector("button")!.click();
    expect(clicked).toBe(true);
  });
});
