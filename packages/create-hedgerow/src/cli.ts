import { createInterface } from "node:readline/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createStarter, type CreateStarterOptions, type PackageManager } from "./starter.js";

interface CliOptions extends Partial<CreateStarterOptions> {
  help?: boolean;
}

const HELP = `Create a Hedgerow Astro publication.

Usage:
  npm create hedgerow@latest [directory] [options]
  npx create-hedgerow [directory] [options]

Options:
  --author <did>        Immutable author DID (required)
  --url <https-url>     Canonical publication URL (required)
  --name <name>         Publication name (required)
  --package-manager <name>  pnpm, npm, yarn, or bun
  --no-install          Generate without installing dependencies
  --dry-run             Print the files without writing them
  --force               Overwrite matching files in a non-empty directory
  -h, --help            Show this help
`;

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") options.help = true;
    else if (argument === "--no-install") options.install = false;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--author") options.authorDid = argv[++index];
    else if (argument === "--url") options.siteUrl = argv[++index];
    else if (argument === "--name") options.siteName = argv[++index];
    else if (argument === "--package-manager") options.packageManager = argv[++index] as PackageManager;
    else if (argument.startsWith("-")) throw new Error(`unknown option: ${argument}`);
    else if (!options.directory) options.directory = argument;
    else throw new Error(`unexpected argument: ${argument}`);
  }
  return options;
}

async function completeOptions(options: CliOptions): Promise<CreateStarterOptions> {
  if (options.authorDid && options.siteUrl && options.siteName) {
    return {
      directory: options.directory ?? "hedgerow-site",
      authorDid: options.authorDid,
      siteUrl: options.siteUrl,
      siteName: options.siteName,
      ...(options.packageManager ? { packageManager: options.packageManager } : {}),
      ...(options.install !== undefined ? { install: options.install } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    };
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("--author, --url, and --name are required in non-interactive use");
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const directory = (options.directory ?? (await prompt.question("Directory (hedgerow-site): ")).trim()) || "hedgerow-site";
    const authorDid = options.authorDid ?? (await prompt.question("Author DID: ")).trim();
    const siteUrl = options.siteUrl ?? (await prompt.question("Canonical site URL: ")).trim();
    const siteName = options.siteName ?? (await prompt.question("Publication name: ")).trim();
    return {
      directory,
      authorDid,
      siteUrl,
      siteName,
      ...(options.packageManager ? { packageManager: options.packageManager } : {}),
      ...(options.install !== undefined ? { install: options.install } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    };
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const plan = await createStarter(await completeOptions(parsed));
  if (parsed.dryRun) {
    process.stdout.write(`Would create ${plan.files.length} files in ${plan.directory}:\n`);
    for (const file of plan.files) process.stdout.write(`  ${file}\n`);
    return;
  }
  process.stdout.write(`\nCreated Hedgerow in ${plan.directory}.\n\n`);
  process.stdout.write(`Next:\n  cd ${plan.directory}\n`);
  if (!plan.install) process.stdout.write(`  ${plan.packageManager} install\n`);
  process.stdout.write(`  ${plan.packageManager} run hedgerow:bootstrap\n`);
  process.stdout.write(`  ${plan.packageManager} run dev\n`);
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(`create-hedgerow: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
