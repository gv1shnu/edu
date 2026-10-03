#!/bin/sh
# One-time GitHub configuration after the repo exists and `main` is pushed.
# Requires the GitHub CLI logged in as the repo owner: `gh auth login`.
#
#   scripts/github-setup.sh <owner/repo> [secrets-file]
#
# secrets-file (default .local/github-secrets.env, never committed) holds KEY=value lines:
#   VPS_HOST, VPS_USER, VPS_SSH_KEY (the private key, one line with \n escapes or use a file),
#   VPS_APP_DIR,
#   AUTOMATION_TOKEN (fine-grained PAT: contents + pull requests read/write on this repo).
set -eu
REPO="${1:?owner/repo required}"
SECRETS="${2:-.local/github-secrets.env}"

# Branches: `main` is production; each major feature gets its own `feature/<name>` branch,
# merged into main by pull request once CI is green.
echo "→ repository settings: auto-merge, delete merged feature branches, main as default"
gh api -X PATCH "repos/$REPO" \
  -F allow_auto_merge=true -F delete_branch_on_merge=true \
  -F allow_merge_commit=true -F allow_squash_merge=true -F allow_rebase_merge=false \
  -f default_branch=main >/dev/null

# No visibility change. Production backup credentials belong only on the VPS.
echo "→ secret scanning, push protection and Dependabot alerts"
gh api -X PATCH "repos/$REPO" --input - >/dev/null <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null

echo "→ protect main: changes only via pull request with green CI, no force pushes, admins included"
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["checks", "e2e", "images"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
JSON

echo "→ production environment (deploys only from main)"
gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null <<'JSON'
{ "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
JSON

if [ -f "$SECRETS" ]; then
  echo "→ secrets from $SECRETS"
  gh secret set --repo "$REPO" --env-file "$SECRETS"
  gh secret set --repo "$REPO" --env production --env-file "$SECRETS"
else
  echo "  (no $SECRETS; add secrets later with: gh secret set --repo $REPO --env-file <file>)"
fi
echo "Done."
