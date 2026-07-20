import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { Reply, useReplyContext } from "../src/index";

const SESSION = { did: "did:plc:reader", handle: "reader.bsky.social", displayName: "Reader" };

/** The canonical composer template, exercised by most tests. */
function Composer(props: Partial<React.ComponentProps<typeof Reply.Root>> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn(async () => {});
  return (
    <Reply.Root session={SESSION} onSubmit={onSubmit} {...props}>
      <Reply.SignedOut data-testid="signed-out">Log in to reply.</Reply.SignedOut>
      <Reply.SignedIn data-testid="signed-in">
        <Reply.Field data-testid="field" placeholder="Write a reply…" />
        <Reply.Submit data-testid="submit" />
        <Reply.Error data-testid="error" />
      </Reply.SignedIn>
    </Reply.Root>
  );
}

describe("Reply.SignedIn / Reply.SignedOut", () => {
  it("renders SignedIn and not SignedOut when a session is given", () => {
    const { queryByTestId } = render(<Composer />);
    expect(queryByTestId("signed-in")).not.toBeNull();
    expect(queryByTestId("signed-out")).toBeNull();
  });

  it("renders SignedOut and not SignedIn when session is null", () => {
    const { queryByTestId } = render(<Composer session={null} />);
    expect(queryByTestId("signed-out")).not.toBeNull();
    expect(queryByTestId("signed-in")).toBeNull();
  });
});

describe("Reply.Field", () => {
  it("is controlled by Root's state and starts empty", () => {
    const { getByTestId } = render(<Composer />);
    const field = getByTestId("field") as HTMLTextAreaElement;
    expect(field.value).toBe("");
  });

  it("seeds from Root's defaultValue", () => {
    const { getByTestId } = render(<Composer defaultValue="hello there" />);
    expect((getByTestId("field") as HTMLTextAreaElement).value).toBe("hello there");
  });

  it("updates on change and reflects data-signed-in", () => {
    const { getByTestId } = render(<Composer />);
    const field = getByTestId("field") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Great post!" } });
    expect(field.value).toBe("Great post!");
    expect(field.getAttribute("data-signed-in")).toBe("");
  });
});

describe("Reply.Submit", () => {
  it("is disabled while the field is empty and enabled once it has text", () => {
    const { getByTestId } = render(<Composer />);
    const field = getByTestId("field") as HTMLTextAreaElement;
    const submit = getByTestId("submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(field, { target: { value: "hi" } });
    expect(submit.disabled).toBe(false);

    fireEvent.change(field, { target: { value: "   " } });
    expect(submit.disabled).toBe(true);
  });

  it("defaults to 'Reply' text and 'Posting…' while submitting", async () => {
    const gate = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, resolve };
    })();
    const onSubmit = vi.fn(() => gate.promise);
    const { getByTestId, container } = render(<Composer onSubmit={onSubmit} />);
    const field = getByTestId("field") as HTMLTextAreaElement;
    const submit = getByTestId("submit") as HTMLButtonElement;

    expect(submit.textContent).toBe("Reply");
    fireEvent.change(field, { target: { value: "hi" } });
    fireEvent.click(submit);

    await waitFor(() => expect(submit.textContent).toBe("Posting…"));
    expect(submit.disabled).toBe(true);
    expect(container.querySelector("form")!.getAttribute("data-submitting")).toBe("");

    gate.resolve();
    await waitFor(() => expect(submit.textContent).toBe("Reply"));
  });
});

describe("Reply submit flow", () => {
  it("submits the trimmed text, clears the field, and calls onSubmitted", async () => {
    const onSubmit = vi.fn(async () => {});
    const onSubmitted = vi.fn();
    const { getByTestId } = render(<Composer onSubmit={onSubmit} onSubmitted={onSubmitted} />);
    const field = getByTestId("field") as HTMLTextAreaElement;
    const submit = getByTestId("submit") as HTMLButtonElement;

    fireEvent.change(field, { target: { value: "  Great post!  " } });
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Great post!"));
    await waitFor(() => expect(field.value).toBe(""));
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("submits via the form's native submit (Enter-in-field semantics)", async () => {
    const onSubmit = vi.fn(async () => {});
    const { getByTestId, container } = render(<Composer onSubmit={onSubmit} />);
    fireEvent.change(getByTestId("field"), { target: { value: "hi" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("hi"));
  });

  it("does not submit an empty or whitespace-only field", async () => {
    const onSubmit = vi.fn(async () => {});
    const { getByTestId, container } = render(<Composer onSubmit={onSubmit} />);
    fireEvent.change(getByTestId("field"), { target: { value: "   " } });
    fireEvent.submit(container.querySelector("form")!);

    await new Promise((r) => setTimeout(r, 10));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows Reply.Error and keeps the text when onSubmit rejects, without calling onSubmitted", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("network down");
    });
    const onSubmitted = vi.fn();
    const { getByTestId, findByTestId } = render(<Composer onSubmit={onSubmit} onSubmitted={onSubmitted} />);
    const field = getByTestId("field") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "hi" } });
    fireEvent.click(getByTestId("submit"));

    const error = await findByTestId("error");
    expect(error.getAttribute("role")).toBe("alert");
    expect(field.value).toBe("hi"); // text preserved on failure
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

describe("Reply.Root data-attributes", () => {
  it("reflects status/signed-in on the root form element", async () => {
    const onSubmit = vi.fn(async () => {});
    const { container, getByTestId } = render(<Composer onSubmit={onSubmit} />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("data-status")).toBe("idle");
    expect(form.getAttribute("data-signed-in")).toBe("");
    expect(form.hasAttribute("data-submitting")).toBe(false);

    fireEvent.change(getByTestId("field"), { target: { value: "hi" } });
    fireEvent.submit(form);
    await waitFor(() => expect(form.getAttribute("data-status")).toBe("idle"));
  });
});

describe("Reply render-prop and escape hatch", () => {
  it("supports a fully custom field via useReplyContext", () => {
    function CustomField() {
      const { value, setValue } = useReplyContext();
      return <input data-testid="custom" value={value} onChange={(e) => setValue(e.target.value)} />;
    }
    const { getByTestId } = render(
      <Reply.Root session={SESSION} onSubmit={vi.fn(async () => {})}>
        <CustomField />
        <Reply.Submit data-testid="submit" />
      </Reply.Root>,
    );
    const input = getByTestId("custom") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "custom text" } });
    expect((getByTestId("submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("swaps the Submit element via render and merges className", () => {
    const { container } = render(
      <Reply.Root session={SESSION} onSubmit={vi.fn(async () => {})}>
        <Reply.Field />
        <Reply.Submit className="my-submit" render={(props, state) => <a href="#" {...props}>{state.isDisabled ? "…" : "Go"}</a>} />
      </Reply.Root>,
    );
    const anchor = container.querySelector("a.my-submit")!;
    expect(anchor.tagName).toBe("A");
    expect(anchor.textContent).toBe("…");
  });

  it("throws a descriptive error when a part is used outside Reply.Root", () => {
    // Swallow the expected React error-boundary console noise for this one case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Reply.Field />)).toThrow(/Reply\.Root/);
    spy.mockRestore();
  });
});
