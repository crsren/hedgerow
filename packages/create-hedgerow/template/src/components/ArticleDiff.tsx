import { diffLines, diffWordsWithSpace, type Change } from "diff";
import type { ArticleFields } from "../hedgerow/drafts";

function Words({ before, after }: { before: string; after: string }) {
  return diffWordsWithSpace(before, after).map((part: Change, index) =>
    part.added ? <ins key={index}>{part.value}</ins>
      : part.removed ? <del key={index}>{part.value}</del>
      : <span key={index}>{part.value}</span>,
  );
}

function Lines({ before, after }: { before: string; after: string }) {
  return diffLines(before, after).flatMap((part: Change, partIndex) =>
    part.value.split("\n").filter((line, index, lines) => line || index < lines.length - 1).map((line, lineIndex) => {
      const content = <><span aria-hidden="true">{part.added ? "+" : part.removed ? "−" : " "}</span>{line || " "}</>;
      const key = `${partIndex}:${lineIndex}`;
      return part.added ? <ins key={key}>{content}</ins>
        : part.removed ? <del key={key}>{content}</del>
        : <span key={key}>{content}</span>;
    }),
  );
}

export default function ArticleDiff({ published, draft }: { published: ArticleFields; draft: ArticleFields }) {
  const fields = [
    { label: "Title", before: published.title, after: draft.title },
    { label: "URL", before: published.path, after: draft.path },
    { label: "Date", before: published.publishedAt.slice(0, 10), after: draft.publishedAt.slice(0, 10) },
    { label: "Description", before: published.description, after: draft.description },
    { label: "Tags", before: published.tags.join(", "), after: draft.tags.join(", ") },
    { label: "Article", before: published.markdown, after: draft.markdown, body: true },
  ].filter(({ before, after }) => before !== after);

  return (
    <section className="hedgerow-diff" aria-label="Changes from the published article">
      <header><h2>Changes</h2><p><del>Published</del><ins>Draft</ins></p></header>
      {fields.length === 0 ? <p>No changes to publish.</p> : fields.map((field) => (
        <section key={field.label}>
          <h3>{field.label}</h3>
          {field.body
            ? <pre><code><Lines before={field.before} after={field.after} /></code></pre>
            : <p><Words before={field.before || "None"} after={field.after || "None"} /></p>}
        </section>
      ))}
    </section>
  );
}
