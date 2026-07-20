import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { Editor, useEditorContext } from "../src/index";

const DOC = { title: "Original Title", markdown: "Original body." };

/** The canonical editor template, exercised by most tests. */
function EditorComposer(props: Partial<React.ComponentProps<typeof Editor.Root>> = {}) {
  const onSave = props.onSave ?? vi.fn(async () => {});
  return (
    <Editor.Root document={DOC} onSave={onSave} {...props}>
      <Editor.Title data-testid="title" />
      <Editor.Body data-testid="body" />
      <Editor.Save data-testid="save" />
      <Editor.Status data-testid="status" />
    </Editor.Root>
  );
}

describe("Editor.Root loading / editing", () => {
  it("starts in loading state and disables Title/Body when document is null", () => {
    const { getByTestId, container } = render(
      <Editor.Root document={null} onSave={vi.fn(async () => {})}>
        <Editor.Title data-testid="title" />
        <Editor.Body data-testid="body" />
        <Editor.Status data-testid="status" />
      </Editor.Root>,
    );
    expect(container.querySelector("form")!.getAttribute("data-status")).toBe("loading");
    expect((getByTestId("title") as HTMLInputElement).disabled).toBe(true);
    expect((getByTestId("body") as HTMLTextAreaElement).disabled).toBe(true);
    expect(getByTestId("status").textContent).toBe("Loading…");
  });

  it("populates Title/Body from `document` once loaded and reports status editing", () => {
    const { getByTestId, container } = render(<EditorComposer />);
    expect((getByTestId("title") as HTMLInputElement).value).toBe("Original Title");
    expect((getByTestId("body") as HTMLTextAreaElement).value).toBe("Original body.");
    expect(container.querySelector("form")!.getAttribute("data-status")).toBe("editing");
  });

  it("resets fields when `document` changes to a new reference", () => {
    const { getByTestId, rerender } = render(<EditorComposer />);
    fireEvent.change(getByTestId("title"), { target: { value: "Edited" } });
    expect((getByTestId("title") as HTMLInputElement).value).toBe("Edited");

    const NEW_DOC = { title: "A Different Post", markdown: "Different body." };
    rerender(<EditorComposer document={NEW_DOC} />);
    expect((getByTestId("title") as HTMLInputElement).value).toBe("A Different Post");
    expect((getByTestId("body") as HTMLTextAreaElement).value).toBe("Different body.");
  });

  it("re-rendering with the SAME document reference does not clobber in-progress edits", () => {
    const { getByTestId, rerender } = render(<EditorComposer />);
    fireEvent.change(getByTestId("title"), { target: { value: "Edited" } });
    rerender(<EditorComposer />); // same DOC reference
    expect((getByTestId("title") as HTMLInputElement).value).toBe("Edited");
  });
});

describe("Editor.Title / Editor.Body", () => {
  it("editing Title or Body flips status to dirty", () => {
    const { getByTestId, container } = render(<EditorComposer />);
    fireEvent.change(getByTestId("title"), { target: { value: "New Title" } });
    expect(container.querySelector("form")!.getAttribute("data-status")).toBe("dirty");
  });

  it("Editor.Body's default render is a plain textarea bound to markdown", () => {
    const { getByTestId } = render(<EditorComposer />);
    const body = getByTestId("body") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "New body text." } });
    expect(body.value).toBe("New body text.");
  });

  it("Editor.Body's render prop hands back { value, onChange } for the markdown string, not DOM props", () => {
    const { getByTestId } = render(
      <Editor.Root document={DOC} onSave={vi.fn(async () => {})}>
        <Editor.Body
          render={(slot) => (
            <input
              data-testid="custom-body"
              value={slot.value}
              onChange={(e) => slot.onChange(e.target.value)}
            />
          )}
        />
      </Editor.Root>,
    );
    const custom = getByTestId("custom-body") as HTMLInputElement;
    expect(custom.value).toBe("Original body.");
    fireEvent.change(custom, { target: { value: "Custom editor body" } });
    expect(custom.value).toBe("Custom editor body");
  });
});

describe("Editor.Save", () => {
  it("is disabled until the document is dirty, and disabled again while saving", async () => {
    const gate = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, resolve };
    })();
    const onSave = vi.fn(() => gate.promise);
    const { getByTestId } = render(<EditorComposer onSave={onSave} />);
    const save = getByTestId("save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(getByTestId("title"), { target: { value: "Edited" } });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(save.textContent).toBe("Saving…"));
    expect(save.disabled).toBe(true);

    gate.resolve();
    await waitFor(() => expect(save.disabled).toBe(true)); // saved, and clean again
  });
});

describe("Editor save flow", () => {
  it("submits the current fields and reaches status saved", async () => {
    const onSave = vi.fn(async () => {});
    const { getByTestId, container } = render(<EditorComposer onSave={onSave} />);
    fireEvent.change(getByTestId("title"), { target: { value: "Edited Title" } });
    fireEvent.change(getByTestId("body"), { target: { value: "Edited body." } });
    fireEvent.click(getByTestId("save"));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ title: "Edited Title", markdown: "Edited body." }),
    );
    await waitFor(() => expect(container.querySelector("form")!.getAttribute("data-status")).toBe("saved"));
    expect(getByTestId("status").textContent).toBe("Saved");
  });

  it("submits via the form's native submit", async () => {
    const onSave = vi.fn(async () => {});
    const { getByTestId, container } = render(<EditorComposer onSave={onSave} />);
    fireEvent.change(getByTestId("title"), { target: { value: "Edited" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("does nothing when save() is called while not dirty", async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(<EditorComposer onSave={onSave} />);
    fireEvent.submit(container.querySelector("form")!);

    await new Promise((r) => setTimeout(r, 10));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows Editor.Status with role=alert and keeps the fields when onSave rejects", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("network down");
    });
    const { getByTestId, findByTestId } = render(<EditorComposer onSave={onSave} />);
    fireEvent.change(getByTestId("title"), { target: { value: "Edited Title" } });
    fireEvent.click(getByTestId("save"));

    const status = await findByTestId("status");
    await waitFor(() => expect(status.getAttribute("role")).toBe("alert"));
    expect(status.textContent).toBe("Couldn't save");
    expect((getByTestId("title") as HTMLInputElement).value).toBe("Edited Title"); // preserved on failure
  });
});

describe("Editor render-prop and escape hatch", () => {
  it("supports a fully custom title field via useEditorContext", () => {
    function CustomTitle() {
      const { title, setTitle } = useEditorContext();
      return <input data-testid="custom-title" value={title} onChange={(e) => setTitle(e.target.value)} />;
    }
    const { getByTestId } = render(
      <Editor.Root document={DOC} onSave={vi.fn(async () => {})}>
        <CustomTitle />
        <Editor.Save data-testid="save" />
      </Editor.Root>,
    );
    fireEvent.change(getByTestId("custom-title"), { target: { value: "custom text" } });
    expect((getByTestId("save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("swaps the Save element via render and merges className", () => {
    const { container } = render(
      <Editor.Root document={DOC} onSave={vi.fn(async () => {})}>
        <Editor.Title />
        <Editor.Save
          className="my-save"
          render={(props, state) => (
            <a href="#" {...props}>
              {state.isDisabled ? "…" : "Go"}
            </a>
          )}
        />
      </Editor.Root>,
    );
    const anchor = container.querySelector("a.my-save")!;
    expect(anchor.tagName).toBe("A");
    expect(anchor.textContent).toBe("…");
  });

  it("throws a descriptive error when a part is used outside Editor.Root", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Editor.Title />)).toThrow(/Editor\.Root/);
    spy.mockRestore();
  });
});
