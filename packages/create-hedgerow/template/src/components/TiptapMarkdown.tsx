import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function markdownStorage(editor: Editor): MarkdownStorage {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown;
}

export default function TiptapMarkdown({ value, onChange, disabled = false }: Props) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, transformPastedText: true })],
    content: value,
    editable: !disabled,
    editorProps: { attributes: { "aria-label": "Article body" } },
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.docChanged) onChange(markdownStorage(current).getMarkdown());
    },
  });

  useEffect(() => {
    if (editor && markdownStorage(editor).getMarkdown() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => editor?.setEditable(!disabled), [disabled, editor]);

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link", previous ?? "https://");
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const controls = [
    ["Bold", "B", () => editor?.chain().focus().toggleBold().run(), "bold"],
    ["Italic", "I", () => editor?.chain().focus().toggleItalic().run(), "italic"],
    ["Heading 2", "H2", () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), "heading"],
    ["Heading 3", "H3", () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), "heading"],
    ["Bullet list", "•", () => editor?.chain().focus().toggleBulletList().run(), "bulletList"],
    ["Numbered list", "1.", () => editor?.chain().focus().toggleOrderedList().run(), "orderedList"],
    ["Quote", "“”", () => editor?.chain().focus().toggleBlockquote().run(), "blockquote"],
    ["Code block", "</>", () => editor?.chain().focus().toggleCodeBlock().run(), "codeBlock"],
  ] as const;

  return (
    <div className="hedgerow-tiptap">
      <div className="hedgerow-toolbar" role="toolbar" aria-label="Formatting">
        {controls.map(([label, text, run, active]) => (
          <button key={label} type="button" title={label} aria-label={label}
            aria-pressed={editor?.isActive(active) ?? false} onClick={run} disabled={disabled || !editor}>
            {text}
          </button>
        ))}
        <button type="button" title="Link" aria-label="Link" aria-pressed={editor?.isActive("link") ?? false}
          onClick={setLink} disabled={disabled || !editor}>↗</button>
        <span className="hedgerow-toolbar-space" />
        <button type="button" aria-label="Undo" onClick={() => editor?.chain().focus().undo().run()} disabled={disabled || !editor?.can().undo()}>↶</button>
        <button type="button" aria-label="Redo" onClick={() => editor?.chain().focus().redo().run()} disabled={disabled || !editor?.can().redo()}>↷</button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
