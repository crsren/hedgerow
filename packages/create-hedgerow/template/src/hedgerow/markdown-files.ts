import type { ArticleFields } from "./drafts";

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  return frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1];
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function unsupportedMarkdown(markdown: string): string[] {
  const warnings = new Set<string>();
  if (/^\s*\|.+\|\s*$/m.test(markdown)) warnings.add("tables");
  if (/!\[[^\]]*\]\([^)]+\)/.test(markdown)) warnings.add("images");
  if (/^\[\^[^\]]+\]:/m.test(markdown) || /\[\^[^\]]+\]/.test(markdown)) warnings.add("footnotes");
  if (/<[A-Za-z][^>]*>/.test(markdown)) warnings.add("raw HTML");
  return [...warnings];
}

export function importMarkdown(source: string, filename: string): ArticleFields {
  let body = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let frontmatter = "";
  const block = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (block) {
    frontmatter = block[1]!;
    body = body.slice(block[0].length);
  }

  let title = frontmatterValue(frontmatter, "title");
  if (title) title = unquote(title);
  if (!title) {
    const heading = body.match(/^#\s+(.+)\n?/);
    if (heading) {
      title = heading[1]!.trim();
      body = body.slice(heading[0].length);
    }
  }
  const fallback = filename.replace(/\.(md|markdown)$/i, "");
  const description = frontmatterValue(frontmatter, "description");
  const tags = frontmatterValue(frontmatter, "tags")
    ?.replace(/^\[|\]$/g, "")
    .split(",")
    .map((tag) => unquote(tag).trim())
    .filter(Boolean) ?? [];
  const date = unquote(frontmatterValue(frontmatter, "publishedAt") ?? "");
  const slug = slugify(frontmatterValue(frontmatter, "slug") ?? fallback ?? title ?? "untitled");

  return {
    title: title || fallback || "Untitled",
    markdown: body.replace(/^\n+/, "").replace(/\s+$/, ""),
    path: `/blog/${slug}`,
    description: description ? unquote(description) : "",
    tags,
    publishedAt: date && !Number.isNaN(Date.parse(date))
      ? new Date(date).toISOString()
      : new Date().toISOString(),
  };
}

export function exportMarkdown(document: ArticleFields): string {
  const lines = [
    "---",
    `title: ${JSON.stringify(document.title)}`,
    `slug: ${JSON.stringify(document.path.replace(/^.*\//, ""))}`,
    `publishedAt: ${document.publishedAt}`,
  ];
  if (document.description) lines.push(`description: ${JSON.stringify(document.description)}`);
  if (document.tags.length) lines.push(`tags: [${document.tags.map((tag) => JSON.stringify(tag)).join(", ")}]`);
  lines.push("---", "", document.markdown.trimEnd(), "");
  return lines.join("\n");
}

export function markdownFilename(document: ArticleFields): string {
  return `${document.path.replace(/^.*\//, "") || slugify(document.title) || "untitled"}.md`;
}
