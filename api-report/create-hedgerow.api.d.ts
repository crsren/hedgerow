// API report for create-hedgerow — GENERATED, DO NOT EDIT.
//
// Regenerate with `pnpm api:report`. A diff in this file is a change to
// what consumers can import — read it to decide the version bump.
// See CONTRIBUTING.md ("Choosing the version bump").

declare const SUPPORTED_PACKAGE_MANAGERS: readonly [
    "pnpm",
    "npm",
    "yarn",
    "bun"
];
type PackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];
interface CreateStarterOptions {
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
interface StarterPlan {
    directory: string;
    files: string[];
    packageManager: PackageManager;
    install: boolean;
}
declare function validateStarterOptions(options: CreateStarterOptions): void;
declare function planStarter(options: CreateStarterOptions): Promise<StarterPlan>;
declare function createStarter(options: CreateStarterOptions): Promise<StarterPlan>;
export { type CreateStarterOptions, type StarterPlan, createStarter, planStarter, validateStarterOptions };
