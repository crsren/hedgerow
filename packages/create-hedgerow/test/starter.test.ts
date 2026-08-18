import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli.js";
import {
  createStarter,
  planStarter,
  validateStarterOptions,
} from "../src/starter.js";

const base = {
  authorDid: "did:plc:starter",
  siteUrl: "https://example.com/",
  siteName: "Example Site",
  install: false,
};

async function planFiles(directory: string): Promise<string[]> {
  return (await planStarter({ ...base, directory })).files;
}

describe("createStarter", () => {
  it("plans without writing and exposes every generated file", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-hedgerow-plan-"));
    const target = join(root, "site");

    const plan = await planStarter({ ...base, directory: target, dryRun: true });

    expect(plan.directory).toBe(target);
    expect(plan.files).toContain(".gitignore");
    expect(plan.files).toContain("src/pages/sudo.astro");
    await expect(readdir(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renders immutable identity and site configuration into a complete starter", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-hedgerow-write-"));
    const target = join(root, "my-publication");

    await createStarter({ ...base, directory: target });

    const config = await readFile(join(target, "hedgerow.config.mjs"), "utf8");
    const readme = await readFile(join(target, "README.md"), "utf8");
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(config).toContain(base.authorDid);
    expect(config).toContain("https://example.com");
    expect(config).not.toContain("__HEDGEROW_");
    expect(manifest.name).toBe("my-publication");
    expect(manifest.dependencies.hedgerow).toBe("^0.1.0");
    expect(manifest.dependencies["@hedgerow/react"]).toBe("^0.3.0");
    expect(readme).not.toContain("__HEDGEROW_");
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(manifest).not.toHaveProperty("packageManager");
    expect(await planFiles(target)).not.toContain("CHANGELOG.md");
  });

  it.each(["pnpm", "npm", "yarn", "bun"] as const)(
    "renders %s commands consistently",
    async (packageManager) => {
      const root = await mkdtemp(join(tmpdir(), `create-hedgerow-${packageManager}-`));
      const target = join(root, "site");
      await createStarter({ ...base, directory: target, packageManager });
      const readme = await readFile(join(target, "README.md"), "utf8");
      expect(readme).toContain(`${packageManager} run hedgerow:bootstrap`);
      expect(readme).toContain(`${packageManager} run dev`);
    },
  );

  it("escapes configuration as JavaScript and JSON values", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-hedgerow-escape-"));
    const target = join(root, "site");

    await createStarter({
      ...base,
      directory: target,
      siteName: 'Chris "CR$&"',
      projectName: "Chris's Site",
    });

    const config = await readFile(join(target, "hedgerow.config.mjs"), "utf8");
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(config).toContain('siteName: "Chris \\"CR$&\\""');
    expect(manifest.name).toBe("chris-s-site");
  });

  it("does not overwrite a non-empty target without explicit force", async () => {
    const root = await mkdtemp(join(tmpdir(), "create-hedgerow-conflict-"));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "keep.txt"), "mine", "utf8");

    await expect(createStarter({ ...base, directory: root })).rejects.toThrow(/not empty/);
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("mine");
  });
});

describe("CLI", () => {
  it("parses explicit non-interactive options", () => {
    expect(parseCliArgs([
      "site",
      "--author", "did:plc:starter",
      "--url", "https://example.com",
      "--name", "Example",
      "--no-install",
      "--dry-run",
    ])).toMatchObject({
      directory: "site",
      authorDid: "did:plc:starter",
      siteUrl: "https://example.com",
      siteName: "Example",
      install: false,
      dryRun: true,
    });
  });

  it("rejects mutable handles in author configuration", () => {
    expect(() => validateStarterOptions({
      ...base,
      directory: "site",
      authorDid: "alice.bsky.social",
    })).toThrow(/immutable/);
  });
});
