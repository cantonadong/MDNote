# Repository agent instructions

## GitHub CLI authentication

- GitHub CLI credentials are stored in Windows Credential Manager and are not readable from the filesystem sandbox.
- Run every `gh` command that calls the GitHub API with `sandbox_permissions: "require_escalated"`. This includes `gh api`, `gh auth status`, `gh release`, `gh pr`, and `gh workflow` commands.
- A `401 Requires authentication` result from a sandboxed `gh` command is a sandbox credential-access failure, not evidence that the token is expired.
- Do not run `gh auth login`, `gh auth refresh`, or `gh auth logout` in response to a sandboxed 401. Retry the original command with `require_escalated` first.
- Ordinary `git` operations may continue to use Git Credential Manager normally.
