// The rich-text editor mounted into @hedgerow/react's Editor.Body slot
// (SLIMS-64). Tiptap (@tiptap/react + @tiptap/starter-kit) + tiptap-markdown
// are DEMO (app-land) dependencies only — @hedgerow/react itself never
// depends on an editor library (see docs/architecture.md and Editor.Body's
// own doc comment in packages/react/src/editor.tsx): Editor.Body just hands
// this component `{ value, onChange }` for the markdown string.
//
// Markdown round-trip: tiptap-markdown's `Markdown` extension lets Tiptap
// treat markdown as its content format directly — `content: value` on
// useEditor() parses markdown into the ProseMirror doc, and
// `editor.storage.markdown.getMarkdown()` serializes back out on every edit.
// Known lossy edges (worth knowing, not blocking for v1):
//   - @tiptap/starter-kit's node/mark set is a common subset (paragraphs,
//     headings, bold/italic/strike/code, bullet/ordered lists, blockquote,
//     code block, hr, hard break, links via the Link extension bundled in
//     starter-kit v3) — markdown features OUTSIDE that set (tables, images,
//     footnotes, raw HTML blocks/inline HTML) are not part of the schema, so
//     round-tripping a post that used them will drop or flatten them to text.
//   - Reference-style links (`[text][ref]` + a separate `[ref]: url` line)
//     normalize to inline links (`[text](url)`) on the way back out.
//   - Exotic whitespace (three-or-more blank lines, trailing hard-break
//     spaces) gets normalized to the renderer's canonical spacing.
// None of this matters for the demo's own posts (plain prose + headings/
// lists/emphasis/links), but it's the honest caveat for anyone editing a post
// that used a markdown feature StarterKit doesn't model.
import { useEffect } from "react";
import { useEditor as useTiptapEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";

export interface TiptapMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// tiptap-markdown's types don't module-augment @tiptap/core's `Storage`
// interface with its extension's storage shape, so `editor.storage.markdown`
// isn't visible to TS by default — this helper is the one cast, kept
// self-documenting, that every call site below goes through.
function markdownStorage(editor: Editor): MarkdownStorage {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown;
}

export default function TiptapMarkdownEditor({ value, onChange, disabled }: TiptapMarkdownEditorProps) {
  const editor = useTiptapEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, transformPastedText: true })],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      onChange(markdownStorage(e).getMarkdown());
    },
  });

  // Keep Tiptap's document in sync when `value` changes from OUTSIDE the
  // editor (Editor.Root resetting the fields for a newly-selected post)
  // without fighting the user's own typing: only resync when the markdown
  // Tiptap would currently serialize actually differs from the incoming
  // value (an update WE just emitted via onChange loops back here as the
  // same string, so this is a no-op on every normal keystroke).
  useEffect(() => {
    if (!editor) return;
    const current = markdownStorage(editor).getMarkdown();
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  return <EditorContent editor={editor} className="hedgerow-edit-tiptap" />;
}
