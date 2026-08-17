# Harness Source Updates

This is the terminal-side update path for users who run the official DeepSeek
Harness from a source checkout. It is separate from the macOS App Update feed:

```text
App users       → Check for Updates… → Install Update…
Terminal users  → harness-check → harness-update --apply
```

DSH Stack does not fork Harness, resolve dependencies, or publish a new plugin
manifest. Git selects the official source ref, pnpm installs the exact
Harness-owned lockfile closure, and DSH Stack supplies the candidate
Freeze/Verify gate.

## Check without changing the checkout

```sh
pnpm dsh-stack harness-check ../deepseek-harness \
  --remote origin --ref master --json
```

The command fetches remote metadata into Git's remote state but does not move
the working branch, edit the Profile, or replace User State. It reports:

- current Harness version, commit, and dirty state;
- the selected official remote ref;
- the candidate version and commit;
- `UP_TO_DATE`, `UPDATE_AVAILABLE`, or `UNAVAILABLE`.

For a reproducible release candidate, check an immutable tag instead of a
moving branch:

```sh
pnpm dsh-stack harness-check ../deepseek-harness \
  --ref dsh-v0.1.0-rc.7 --json
```

## Verify and synchronize the source checkout

`harness-update` is dry-run by default. `--apply` is the explicit mutation
gate:

```sh
pnpm dsh-stack harness-update \
  <current-stack> ../deepseek-harness \
  --remote origin --ref master \
  --apply --report ./artifacts/harness-update.json
```

The operation is:

```text
Git fetch remote ref
↓
Temporary detached Harness worktree
↓
pnpm install --frozen-lockfile
↓
Official `pnpm run build` when the Harness declares it
↓
Upgrade Verify against the current Stack
↓
Runtime Verify PASS
↓
Fast-forward the clean source checkout
↓
pnpm install --frozen-lockfile in the active checkout
```

The command refuses to apply when the source checkout is dirty, the ref
diverged, or candidate verification fails. In those cases the current Stack,
Profile, App, and User State remain unchanged. A final pnpm installation error
is reported as an incomplete source sync; rerun the printed pnpm command before
using the updated checkout.

The report contains the candidate Harness commit and Verification Receipt. It
does not contain API keys, sessions, prompt history, or responses. No LLM
request is required: Runtime Verify only proves official Web UI readiness.

## App release policy

Passing a terminal Harness update does not silently update an installed App or
publish a Stable Release. A maintainer still explicitly runs:

```text
Freeze → Verify → Package → Release Candidate → manual release decision
```

The App's `storageId` remains unchanged across this process so credentials and
sessions stay in the same User State directory.
