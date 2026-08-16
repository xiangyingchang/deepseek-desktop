# Phase 2 Lifecycle — Base, Derived, Rebase, Share

This document is the implementation companion to [PRD §140](../PRD.md). It defines how DSH Stack supports a maintained DeepSeek Desktop Base without turning the App into a second Harness or Plugin ecosystem.

## Product objects

```text
Base Distribution
  exact Harness + exact Profile + curated bundles + Base Receipt

Derived Working Profile
  Base + user Profile changes / standard DSH Bundles

Distribution Candidate
  maintainer Working Profile → Promote → Freeze → Verify → Package

Shareable Stack
  Derived Profile → Preflight → Secret Scan → Freeze → Verify → Pack → .dshstack
```

`package.json`, `dsh.profile.bundles`, `pnpm-lock.yaml` when required, `pnpm-workspace.yaml`, and `cordis.patch.yml` remain the only composition inputs. `distribution.yaml` is release metadata only and never contains a second `bundledPlugins` list.

## Upgrade primitive

The generic primitive is a file/input-level three-way merge:

```text
A = old Base Profile
B = current Derived Profile
C = new Base Profile
User Delta = A → B
Candidate = C + User Delta
```

The implementation is in `packages/core/src/rebase.ts`. It merges independent JSON/YAML object keys, dependency maps, bundle string arrays, and id-keyed Cordis patch rows. It reports `UPDATE_REBASE_CONFLICT` when both sides changed the same scalar, when deletion conflicts with a new Base requirement, or when both sides reorder the same ordered list. It never invokes Harness composition and never edits the active Profile.

The update orchestrator follows:

```text
Rebase candidate
→ Runtime Verify with StackMaterializer
→ copy candidate to same-filesystem staging
→ atomic directory switch
→ keep <active>.previous
```

Any conflict or verification failure leaves the active Profile unchanged.

## Receipt semantics

`verification.receipt.json` binds the exact Stack integrity hash. When `distribution.yaml` is present, the receipt also records whether the verified state is `base`, `derived`, or `candidate`. A Base Receipt is not reused as proof of a modified Derived Profile; the Derived Profile must pass the same Verify pipeline and receive a new receipt.

## Sharing

`dsh-stack pack <stack> --harness <checkout> --output setup.dshstack` first runs the real Runtime Verify in the same command, then creates a zip-compatible archive containing only Stack metadata, Profile inputs, tests, Integrity, optional distribution metadata, and the current Runtime Receipt. Pack rejects edited/stale Receipts, state-bearing paths, credentials, symbolic links, and likely secret values. `dsh-stack import setup.dshstack` validates archive paths, regular-file contents, and integrity before the atomic extraction switch; the next step is the normal `dsh-stack verify` command.

The archive does not include `node_modules`, caches, sessions, API keys, credentials, prompts, responses, personal files, or secret-bearing logs. The recipient gets the same Profile definition and dependency versions but keeps separate credentials and user state.

## Official Harness behavior audited on 2026-08-16

The current official checkout is `deepseek-ai/deepseek-harness`, version `0.1.0-rc.5`, with root `packageManager: pnpm@11.7.0`. The official plugin path is:

```text
dsh plugin --profile <name> <pnpm args>
```

The command forwards to pnpm in the Profile directory and reconciles dependencies that declare `dsh.bundle` into `dsh.profile.bundles`. A Profile is still booted by the official `dsh --profile <name>` / `dsh web` path. DSH Stack delegates those operations and does not recreate them.

## Current evidence boundary

The lifecycle unit and fixture tests prove merge, conflict, secret isolation, archive integrity, and atomic-switch semantics. A real official Harness Runtime Verify remains required before an actual Base/Derived update can be called Live Agent E2E. A clean-machine and Apple signing/notarization result must remain separately labelled; neither is inferred from these tests.

## 2026-08-16 execution record

The following evidence was actually executed against the local official Harness checkout (`0.1.0-rc.5`, commit `47f943859bef60e4160492346772ded9b24f765a`, clean worktree):

| Path | Result | Evidence boundary |
|---|---|---|
| Official `web` Profile Inspect → Freeze → Runtime Verify | PASS | Receipt integrity `sha256-f6ceba5407bf80e21355da0828e11cbc6327b3e37fd36e8fdfdfc52226f0902c`; no LLM request |
| Maintainer Promote → Candidate Runtime Verify | PASS | Candidate distribution metadata was `candidate`; it used the same Harness/Web pipeline |
| `.dshstack` Pack → Import → Runtime Verify | PASS | Imported artifact retained exact Integrity and `distribution.yaml`; no user-state paths were included |
| Derived update with independent user/base Profile changes | PASS | Runtime Verify completed before atomic switch; both changes were present and the old Profile backup existed |
| App runtime Base update | PASS | Isolated packaged runtime merged a user marker and a new Base marker, verified the official UI, then switched atomically |
| App runtime conflict | PASS (blocked as designed) | Same key changed on both sides returned `UPDATE_REBASE_CONFLICT`; active Profile remained unchanged |
| Automated lifecycle tests | PASS | 31/31 tests, including CLI lifecycle parsing, additions, conflicts, Receipt gating, symlink rejection, dependency-closure preservation, archive import, and rollback |

The App runtime checks used an isolated temporary `HOME` and a locally generated test mutation; they are not a clean-machine UAT or a claim that the public Release has been replaced. The live third-party Bundle installation attempt used the real `mario03690/dsh-netcafe` commit `6873f2d` and was blocked inside the official source Harness command by its non-interactive production install/postinstall path (`lefthook` missing before dependency restoration). That remains an upstream Harness/source-install blocker, not a DSH Stack PASS.

## User Data Preservation and Update Transactions

The Profile-level Rebase proof above is not by itself an App update proof. A formal user update must preserve the whole working environment, not only `profiles/<name>`:

```text
Stable Distribution Storage Identity
├── official Harness DSH_HOME state
├── current Derived Profile
├── immutable Base snapshots
├── update transaction journal
└── recovery backups
```

The existing `~/Library/Application Support/DSH Stack/<stable-id>/` root remains the compatibility location for released users. `storageId` must be read identically by the Native Shell and the embedded runtime; App version, Base integrity, Harness version, and the public brand name must never create a new User State root.

The update transaction is:

```text
Verify update metadata
→ stage new App/Base
→ acquire the User State lock
→ capture a value-free User State fingerprint
→ Rebase A(old Base) + B(current Derived) onto C(new Base)
→ Runtime Verify in disposable DSH_HOME
→ write durable recovery journal
→ atomic Profile/App switch
→ first-launch Health Check
→ assert User State fingerprint unchanged
→ commit and retain rollback
```

Credentials, sessions, history, preferences, and workspace data are never Profile inputs and are never copied into a Stack, `.dshstack`, or App artifact. A schema migration must be copy-on-write and reversible. A conflict, Verify failure, corrupted download, wrong architecture, interrupted process, or failed Health Check must leave the old App, old Profile, and User State usable. Profile `.previous` is not a substitute for App rollback.

The current implementation status is intentionally `INCOMPLETE` for Stable until M17–M22 in [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) pass signed-release, clean-machine, and real user-state evidence. M17–M21 now have local implementation and regression evidence: the published Reference storage identity is kept at `dsh-web-5590c2a0cb00b3a7`, the App updater rejects a live Runtime lock, binds candidate Receipt/Integrity metadata, stages against disposable managed state, retains the old App, and commits only after first-launch Web UI health. M22 remains limited to representative local state fixtures and an isolated x86_64 App pair; it does not claim real user-owned Harness session/history migration.
