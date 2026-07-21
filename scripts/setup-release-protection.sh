#!/usr/bin/env bash
# One-time setup for the parts of the release model that live on GitHub and npm
# rather than in this repo. Run it after making the repo public.
#
# WHY THIS EXISTS AS A SCRIPT
#
# CONTRIBUTING.md says "merging the Version Packages PR is the release". That
# sentence is only TRUE if main cannot be pushed to directly. Right now it is a
# statement of intent, not a fact — and branch protection is not available on a
# private repo on the free plan, so it cannot be made a fact until the repo is
# public. A checklist in a doc would rot; this is runnable and idempotent.
#
# Safe to re-run: every step is a PUT/idempotent create.

set -euo pipefail

REPO="${REPO:-crsren/hedgerow}"
BRANCH="main"

command -v gh >/dev/null || { echo "gh CLI is required."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first."; exit 1; }

visibility=$(gh repo view "$REPO" --json visibility --jq '.visibility')
echo "Repository: $REPO ($visibility)"

if [ "$visibility" = "PRIVATE" ]; then
  cat <<'EOF'

  This repo is PRIVATE, which blocks two things:

    * Branch protection — unavailable on private repos on the free plan. Until
      it exists, anyone with write access can push straight to main, and the
      "merge the Version Packages PR" gate can simply be walked around.
    * npm provenance — attestation needs a publicly attestable source.

  Making a repo public is not something a script should do on your behalf.
  When you are ready:

      gh repo edit crsren/hedgerow --visibility public --accept-visibility-change-consequences

  Then re-run this script.

EOF
  exit 1
fi

echo
echo "==> Branch protection on $BRANCH"
# Required checks are named after the `name:` of each job in ci.yml.
gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build / typecheck / test", "changeset policy", "react 18", "react 19"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "    required checks, no force-push, no direct push (admins included)"
echo "    CODEOWNERS review required — this is what protects release.yml"

echo
echo "==> Deployment environment: npm-publish"
gh api -X PUT "repos/$REPO/environments/npm-publish" \
  -F "deployment_branch_policy[protected_branches]=true" \
  -F "deployment_branch_policy[custom_branch_policies]=false" >/dev/null
echo "    scoped to protected branches only (deliberately NO required reviewer —"
echo "    the real approval is merging the Version Packages PR)"

cat <<'EOF'

==> Remaining manual steps (npmjs.com — no API for these)

  For EACH of @hedgerow/comments, react, reader, publish:
    Settings -> Trusted Publisher -> GitHub Actions
      Repository:  crsren/hedgerow
      Workflow:    release.yml
      Environment: npm-publish

  Then, in this repo:
    1. Restore `publish: pnpm release` in .github/workflows/release.yml
       (see the header comment there).
    2. Add `"provenance": true` to each package's publishConfig.
    3. `npm logout` on this machine. With trusted publishing live there is no
       reason for a local session to exist, and its absence is what makes
       "releases come from CI" true rather than merely intended.

EOF
