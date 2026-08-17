import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEMPLATE_DIRECTORY = fileURLToPath(new URL("../template", import.meta.url));
const GENERATOR_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
const HEDGEROW_VERSION_RANGE = "^0.1.0";
const HEDGEROW_REACT_VERSION_RANGE = "^0.3.0";
const SUPPORTED_PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;

export type PackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];

export interface CreateStarterOptions {
  directory: string;
  authorDid: string;
  siteUrl: string;
  siteName: string;
  projectName?: string;
  packageManager?: PackageManager;
  install?: boolean;
  force?: boolean;
  dryRun?: boolean;
  templateDirectory?: string;
}

export interface StarterPlan {
  directory: string;
  files: string[];
  packageManager: PackageManager;
  install: boolean;
}

function packageManagerFromUserAgent(): PackageManager {
  const name = process.env.npm_config_user_agent?.split("/")[0];
  return SUPPORTED_PACKAGE_MANAGERS.find((candidate) => candidate === name) ?? "pnpm";
}

function normalizedProjectName(directory: string, explicit?: string): string {
  const candidate = explicit ?? directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "hedgerow-site";
  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "hedgerow-site";
}

function normalizedSiteUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("siteUrl must use https outside local development");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function validateStarterOptions(options: CreateStarterOptions): void {
  if (!options.directory.trim()) throw new Error("directory must not be empty");
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(options.authorDid)) {
    throw new Error("authorDid must be an immutable AT Protocol DID");
  }
  if (!options.siteName.trim()) throw new Error("siteName must not be empty");
  normalizedSiteUrl(options.siteUrl);
  if (options.packageManager && !SUPPORTED_PACKAGE_MANAGERS.includes(options.packageManager)) {
    throw new Error(`unsupported package manager: ${options.packageManager}`);
  }
}

async function templateFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await templateFiles(root, absolute));
    else if (entry.isFile()) files.push(relative(root, absolute));
  }
  return files;
}

function outputPath(path: string): string {
  return path
    .split(/[\\/]/)
    .map((part) => part === "_gitignore" ? ".gitignore" : part)
    .join("/");
}

function renderTemplate(source: string, options: CreateStarterOptions): string {
  const replacements: Record<string, string> = {
    '"__HEDGEROW_AUTHOR_DID_JSON__"': JSON.stringify(options.authorDid),
    '"__HEDGEROW_SITE_URL_JSON__"': JSON.stringify(normalizedSiteUrl(options.siteUrl)),
    '"__HEDGEROW_SITE_NAME_JSON__"': JSON.stringify(options.siteName.trim()),
    '"hedgerow-starter-template"': JSON.stringify(
      normalizedProjectName(options.directory, options.projectName),
    ),
    "__HEDGEROW_GENERATOR_VERSION__": GENERATOR_VERSION,
    '"hedgerow": "workspace:^"': `"hedgerow": ${JSON.stringify(HEDGEROW_VERSION_RANGE)}`,
    '"@hedgerow/react": "workspace:^"': `"@hedgerow/react": ${JSON.stringify(HEDGEROW_REACT_VERSION_RANGE)}`,
  };
  let rendered = source;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(token, () => value);
  }
  return rendered;
}

async function directoryHasEntries(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function planStarter(options: CreateStarterOptions): Promise<StarterPlan> {
  validateStarterOptions(options);
  const template = resolve(options.templateDirectory ?? TEMPLATE_DIRECTORY);
  await access(join(template, "package.json"));
  const files = (await templateFiles(template)).map(outputPath);
  return {
    directory: resolve(options.directory),
    files,
    packageManager: options.packageManager ?? packageManagerFromUserAgent(),
    install: options.install ?? true,
  };
}

async function installDependencies(directory: string, packageManager: PackageManager): Promise<void> {
  const args = packageManager === "yarn" || packageManager === "bun" ? [] : ["install"];
  await execFileAsync(packageManager, args, {
    cwd: directory,
    env: { ...process.env, CI: "true" },
  });
}

export async function createStarter(options: CreateStarterOptions): Promise<StarterPlan> {
  const plan = await planStarter(options);
  const template = resolve(options.templateDirectory ?? TEMPLATE_DIRECTORY);

  if (await directoryHasEntries(plan.directory) && !options.force) {
    throw new Error(
      `target directory is not empty: ${plan.directory} (pass --force to overwrite matching files)`,
    );
  }
  if (options.dryRun) return plan;

  for (const sourcePath of await templateFiles(template)) {
    const destination = join(plan.directory, outputPath(sourcePath));
    await mkdir(dirname(destination), { recursive: true });
    const source = await readFile(join(template, sourcePath), "utf8");
    await writeFile(destination, renderTemplate(source, options), "utf8");
  }

  if (plan.install) await installDependencies(plan.directory, plan.packageManager);
  return plan;
}
