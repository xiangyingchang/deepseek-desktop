# DeepSeek Desktop (Unofficial) — DSH Stack Implementation Plan

> Authority: [`PRD.md`](PRD.md), DSH Stack PRD v2.3. This file maps the PRD to executable work; it does not redefine the product boundary.

> Current plan status: Phase 2 lifecycle model is frozen and implementation is in progress. The historical M0–M8 records below remain evidence of the completed Freeze → Verify → Reproduce foundation; the lifecycle milestones in this section are the current acceptance plan.

## Frozen product boundary

DSH Stack captures, verifies, reproduces, and eventually packages an existing DeepSeek Harness Profile. It does not implement a Harness runtime, Profile format, Plugin API, pnpm, dependency resolution, Agent Loop, Cordis, or the official Harness Web UI.

The mandatory engineering path is:

```text
Official Harness Profile
        ↓
      Freeze
        ↓
 Verify / Prove
        ↓
    Reproduce
        ↓
      Package
        ↓
 Reference Client
```

`verify` and `run --clean` must call the same `StackMaterializer`; the only difference is whether the materialized Harness process is tested and torn down or kept available to the user.

## Phase 2 Lifecycle Plan — current authoritative milestones

This plan implements the lifecycle model in PRD §140. It is deliberately ordered so that product objects and safety semantics exist before user-facing packaging. No milestone may add Profile-specific branches such as `if profile === X` or a second composition manifest.

| Milestone | Task | Dependencies | Tests | Acceptance Criteria |
|---|---|---|---|---|
| M1 — Architecture Freeze | Lock Base Distribution, Derived Working Profile, Distribution Candidate, Shareable Stack, Profile source of truth, user-state boundary, and no-ecosystem-accumulation rule | Existing M0–M8 audit | Contract/document lint; model serialization tests | PRD and plan agree; `distribution.yaml` is release metadata only; no `bundledPlugins` duplicate |
| M2 — State Model | Represent immutable Base, current Derived state, Candidate, receipts, active profile, and user-state roots | M1 | Schema, path-isolation, immutable-base tests | Base is addressable by exact identity; Derived points to Base and remains a standard Profile |
| M3 — Drift Detection | Compare Base snapshot with current Profile and report user-owned Profile Delta without reading secrets | M2, HarnessAdapter/ProfileInspector | added/removed/modified input fixtures; generated/cache exclusion | Drift reports are deterministic and never mutates the working Profile |
| M4 — Derived Verification | Run Preflight → Freeze/Materialize → Static/Runtime Verify on a Derived Profile and emit a Derived Receipt | M2–M3, shared pipeline | clean derived PASS, secret FAIL, tamper FAIL | Base Receipt is not reused as Derived PASS; receipt binds exact current state |
| M5 — Distribution Rebase | Calculate `A = old Base`, `B = current Derived`, `C = new Base`, produce `C + User Delta` as a standard Profile | M3–M4 | additive plugin merge; config merge; lockfile/source fixtures | Rebase has no Harness composition logic and creates no alternate manifest |
| M6 — Conflict Detection | Detect ambiguous same-file/plugin/version/delete-vs-required changes and return `UPDATE_REBASE_CONFLICT` | M5 | same plugin changed both sides; removed base plugin; lockfile conflict | No guessed merge; old working Profile remains untouched |
| M7 — Verify-before-switch + Atomic Switch | Verify Candidate in a disposable materialization, then atomically activate it; preserve old Active on any failure | M4–M6 | verify fail, runtime fail, crash/interruption, rollback tests | Switch occurs only after PASS; failure leaves old environment usable |
| M8 — Maintainer Promote | Add explicit manual Promote from Working Profile to Base Candidate; automatic detection never publishes | M2–M7 | promotion metadata, candidate receipt, no-auto-release test | Candidate is a new immutable Base input and has its own receipt |
| M9 — Built-in Plugin Promotion E2E | Base v1 → maintainer installs C through official Harness → Drift → Verify → Promote → Base v2 RC | M8, real Harness | real/fixture plugin bundle E2E | C becomes built-in only through standard Freeze → Verify → Package |
| M10 — User Plugin Preservation E2E | Base v1 + X/Y → Base v2 → Rebase → Verify → Atomic Switch | M7, M9 | X/Y survive; Base v2 additions present; state preservation | resulting Profile is exactly Base v2 + X/Y; no silent deletion |
| M11 — Share This Setup | Add Preflight → Secret Scan → Freeze → Verify → Pack for current Derived Profile | M4, M7 | artifact contents, receipt, secret fixtures | `setup.dshstack` is self-contained and excludes user state/secrets |
| M12 — Import `.dshstack` E2E | Inspect → Verify → Materialize → Run in a second Harness home; preserve recipient credentials/state | M11 | cross-home import, integrity/tamper, plugin graph and UI boot | imported Profile is standard Harness Profile; no special client path |
| M13 — Standalone Package | Package a verified Derived Profile as advanced `.app/.dmg` through existing Package pipeline | M4, M7, M11 | package closure, no other Profile pollution, architecture tests | standalone artifact is optional and honest about ad-hoc/signing state |
| M14 — User-state Regression | Prove credentials, compatible sessions, settings, workspace data and user plugins are not copied into share artifacts and survive update | M7, M10–M12 | state fixture, secret scan, upgrade regression | Distribution/Profile Definition remains separate from User State |
| M15 — Upstream Watcher | Observe official Harness release/commit metadata and create an explicit Upgrade Candidate without auto-promoting Stable | M1, current Harness audit | current/unknown candidate, floating-ref and pin tests | watcher records evidence only; no master auto-upgrade |
| M16 — Upgrade Candidate Verification | Verify current Base/Profile and Plugin compatibility against candidate Harness; return explicit PASS/FAIL/UNSUPPORTED | M4, M9, M15 | candidate pass/fail fixtures and receipt tests | exact Plugin/Profile cause is reported; no false compatibility PASS |
| STOP AND REVIEW | Review all E2E evidence, receipts, size/closure boundaries, limitations and external UAT | M1–M16 | full regression suite and actual E2E rerun | produce `PHASE_2_REVIEW.md`; decide Phase 2 GO/NO-GO and whether Phase 3 Verification CI should start |

### Shared pipeline invariant

All lifecycle operations use the same generic seams:

```text
HarnessAdapter
→ ProfileInspector / Preflight
→ Freeze / StackMaterializer
→ Integrity
→ Verifier
→ Receipt
→ Rebase or Package
```

`verify` and `run --clean` continue to share one materialization pipeline. `Share This Setup`, Import, Promote, and Update may add orchestration, but they may not bypass the official Harness or create a second resolver, Plugin system, or runtime.

### Phase 2 record requirements

Each milestone record must include exactly:

1. Implementation Summary
2. Files Changed
3. Architecture Decisions
4. Tests Added
5. Test Results
6. Failure Fixtures Added
7. Known Limitations
8. Security Boundaries
9. PRD Deviations (default: `None`)
10. Readiness for Next Milestone

The record must distinguish evidence from expectation. A fixture PASS is not a real Harness or Live Agent PASS; external UAT and credentials remain explicitly labelled when unavailable.

The detailed execution record for M1–M16 is maintained in [`docs/phase-2-lifecycle-record.md`](docs/phase-2-lifecycle-record.md). M9, M10, M14, M15, M16 and STOP AND REVIEW intentionally retain `INCOMPLETE`/pending evidence where an external Harness install path, newer upstream version, clean machine, or Apple credential is required.

## Harness reality frozen by the initial audit

The adapter is based on the checked-out DeepSeek Harness implementation, not on assumptions from the PRD:

| Contract question | Observed implementation | Adapter consequence |
|---|---|---|
| Harness root | Repository root containing `apps/cli`, `packages`, `native`, and `pnpm-workspace.yaml` | Detect a source checkout by its root and CLI manifests; allow an explicit `DSH_HARNESS_ROOT`/`--harness` override |
| Harness version | `apps/cli/package.json` is `0.1.0-rc.5`; `dsh --version` reads the package manifest adjacent to the CLI entrypoint | Record the exact CLI version and verify it against the Stack pin |
| Harness package manager | Root `package.json` declares `packageManager: pnpm@11.7.0`; the current host reports pnpm `11.12.0` | Record required and observed versions separately; do not create a second resolver |
| CLI source launch | `pnpm dsh ...` invokes `node --import tsx/esm apps/cli/src/bin.ts` from the Harness root | Source adapter invokes this official script with a temporary `DSH_HOME` |
| Installed CLI launch | `apps/cli/package.json` exposes `dsh: lib/bin.js` | Installed adapter may invoke the published `dsh` binary; no global binary is assumed |
| DSH home | `$DSH_HOME`, otherwise `~/.dsh` | Profile path is `$DSH_HOME/profiles/<name>` |
| Official `web` profile | First use creates `package.json`, `pnpm-workspace.yaml`, and `cordis.patch.yml`; bundles are `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` | These are Profile-owned inputs; generated `cordis.yml` is excluded |
| Install fallback | `$DSH_HOME/profiles/node_modules` is maintained by Harness as a flat symlink closure | Exclude it from the artifact; materialization lets the official CLI recreate it |
| Web startup | `dsh web` aliases `--profile web`; default URL is `http://127.0.0.1:3080` and `--host`/`--port` are app arguments | `run --clean` starts the official UI and waits for an HTTP response; no replacement UI is built |

An isolated runtime smoke on 2026-08-15 started `pnpm dsh web --host 127.0.0.1 --port 3187` with a new temporary `DSH_HOME` and received the official HTML response. This proves the current source checkout can boot a clean profile home; it does not yet prove a packaged end-user distribution.

The current official `web` Profile has no `pnpm-lock.yaml` because it has no profile-owned external dependencies. This is represented as an explicit, auditable absence: a lockfile is required when the profile declares external dependencies, but the adapter does not manufacture one for a lock-free vanilla profile.

## Milestone map

### Milestone 0 — Foundation

**Status:** Implemented; regression hardening continues

**Goal:** establish a small TypeScript/pnpm monorepo, a stable CLI contract, structured diagnostics, deterministic exit codes, and test harnesses.

**Tasks**

1. Create root `package.json`, `pnpm-workspace.yaml`, TypeScript configuration, package boundaries, and scripts.
2. Add the `dsh-stack` CLI grammar for `inspect`, `freeze`, `verify`, and `run --clean`.
3. Define shared result types, stage names, error codes, and sanitized diagnostics.
4. Add a real HarnessAdapter interface and a source-checkout adapter that only delegates to the official Harness CLI.
5. Add a shared materializer seam, initially with lifecycle and test doubles but no fake PASS in production paths.
6. Add keyless unit tests for CLI parsing, exit codes, path safety, stage reporting, and secret redaction.

**Dependencies:** none beyond Node.js and pnpm.

**Tests:** `node:test` unit tests; CLI `--help`, `--version`, invalid-command checks; adapter fixture tests.

**Acceptance criteria**

- `pnpm dsh-stack --help` and `pnpm dsh-stack --version` work.
- No code in this milestone implements Harness composition or a plugin system.
- A failed stage is represented as a nonzero, stable exit code and an actionable diagnostic.
- `PRD.md` remains byte-for-byte unchanged from the source copy.

**Milestone record**

- Implementation Summary: CLI and package foundation.
- Files Changed: root manifests, `packages/core`, `packages/cli`, tests, docs.
- Architecture Decisions: adapter-first; Node subprocess delegation; no duplicate lockfile.
- Tests Added: parser, redaction, error/result, and fixture loading tests.
- Test Results: recorded after each implementation/test cycle below.
- Failure Fixtures Added: initial malformed-input and secret fixtures.
- Known Limitations: no profile freeze or runtime verification yet.
- Security Boundaries: no sandbox claim; subprocess execution is not malicious-code isolation.
- PRD Deviations: None.
- Readiness for Next Milestone: adapter can be exercised against the real checkout.

### Milestone 1 — Harness Inspection

**Status:** Implemented; real Harness inspection passed

**Goal:** inspect the real Harness without mutating the user's profile.

**Tasks**

- Locate source or installed Harness through explicit configuration and conservative local discovery.
- Resolve exact CLI version, root package version, package manager requirement, Node engine, OS, and architecture.
- Locate `$DSH_HOME/profiles/<name>` and report whether it was auto-initialized, user-owned, or absent.
- Discover Profile-owned files through the adapter; classify generated `cordis.yml`, fallback `profiles/node_modules`, sessions, credentials, caches, and logs as excluded.
- Report bundle declarations and resolve each bundle through Harness-owned resolution, not a new resolver.
- Report official Web UI command, default port, and source/installed launch mode.

**Dependencies:** M0.

**Tests:** healthy web profile inspection; absent profile; malformed manifest; missing bundle; generated-file exclusion; version mismatch.

**Acceptance criteria:** `dsh-stack inspect --profile web --json` reports the actual profile files, exact version, source mode, and UI launch contract without reading secret values or modifying the real profile.

**Milestone record:** same ten-field report required by PRD; `PRD Deviations: None`.

### Milestone 2 — Preflight

**Status:** Implemented; fixture expansion continues

**Goal:** reject a profile whose manifest, lockfile, installed dependency state, bundle declarations, or Cordis references disagree.

**Tasks**

- Check package/lock importer consistency.
- Treat absent lockfile as valid only when no external profile dependency requires one; never generate a lockfile during inspection or verification.
- Delegate bundle resolution to the adapter and report dangling or bundle-less references.
- Validate profile patch structure without executing `!!js` expressions.
- Detect non-portable dependency sources: absolute paths, `link:`, unresolved `file:`, floating Git refs, and unresolved workspace references.
- Scan captured inputs for high-confidence secrets; block normal freeze.

**Dependencies:** M1.

**Tests:** `broken-lockfile`, `missing-package`, `dangling-bundle`, `bad-cordis-patch`, `local-link`, `floating-git`, `missing-secret`.

**Acceptance criteria:** only `CONSISTENT` profiles enter normal Freeze; every failure names stage, code, component, and repair direction; `--force` records `source.consistency: unverified`.

**Milestone record:** same ten-field report; `PRD Deviations: None`.

### Milestone 3 — Freeze

**Status:** Implemented; real reference artifact frozen

**Goal:** create an auditable Stack artifact from a consistent Profile.

**Tasks**

- Write `stack.yaml` as distribution metadata only.
- Copy only adapter-selected Profile-owned inputs into `profile/`.
- Write deterministic `tests/smoke.yaml` for runtime checks.
- Write `stack.integrity.json` with SHA-256 digests and stable path ordering.
- Preserve secret names, never secret values.
- Record observed versus required Node/pnpm/platform metadata and exact Harness version.

**Dependencies:** M2.

**Tests:** healthy freeze; force-freeze; tampered source; secret block; excluded-file assertions; deterministic integrity output.

**Acceptance criteria:** the artifact contains no `node_modules`, session data, credentials, generated root, or user home files; changing any hashed file makes Verify fail before runtime execution.

**Milestone record:** same ten-field report; `PRD Deviations: None`.

### Milestone 4 — Materializer

**Status:** Implemented; shared materializer exercised

**Goal:** reconstruct a Stack into a disposable DSH home using the official Harness installation and pnpm's strict install mode.

**Tasks**

- Create fresh DSH home, profile directory, workspace, and dependency location.
- Copy the exact frozen Profile inputs.
- Run `pnpm install --frozen-lockfile` only when the artifact contains a lockfile and external dependencies; never mutate the lockfile.
- Let the official CLI recreate generated `cordis.yml` and `profiles/node_modules`.
- Capture stage logs with secret redaction and bounded teardown.

**Dependencies:** M3.

**Tests:** materialize healthy web artifact; no source `node_modules` reuse; frozen install failure; cleanup on spawn/timeout failure.

**Acceptance criteria:** materialization is a single exported implementation used by both Verify and Run; a clean run has a new DSH home and does not touch the source Profile.

**Milestone record:** same ten-field report; `PRD Deviations: None`.

### Milestone 5 — Verification

**Status:** Implemented; deterministic runtime proof passed

**Goal:** prove static integrity and deterministic runtime health without requiring a real LLM response.

**Tasks**

- Implement static schema, integrity, platform, version, and source checks.
- Start the official Harness process in the materialized environment.
- Check HTTP UI health, expected startup signal, profile load, and plugin/bundle activation evidence.
- Keep `--live` reserved and never turn missing credentials/network into PASS.

**Dependencies:** M4.

**Tests:** healthy PASS; tampered FAIL; unsupported platform; unavailable Harness version; boot failure; activation failure; missing capability.

**Acceptance criteria:** no known non-reproducible fixture returns PASS; all runtime checks execute against fresh materialization; third-party-code warning is explicit.

**Milestone record:** same ten-field report; `PRD Deviations: None`.

### Milestone 6 — Receipt

**Status:** Implemented; receipt emitted and bound to integrity

**Goal:** make verification evidence machine-readable and actionable.

**Tasks**

- Emit `verification.receipt.json` for PASS, FAIL, UNSUPPORTED, and INCOMPLETE.
- Bind receipt identity to the exact Stack integrity hash.
- Record environment, Harness version, stages, checks, timestamps, cache policy, and external-service policy.
- Emit human diagnostics and optional sanitized diagnostic files.

**Dependencies:** M5.

**Tests:** receipt schema; receipt invalidation after artifact mutation; redaction; failure taxonomy; stable JSON ordering.

**Acceptance criteria:** a receipt can answer which Stack, which environment, which Harness, which checks, whether third-party code ran, whether external services ran, and where failure occurred.

**Milestone record:** same ten-field report; `PRD Deviations: None`.

### Milestone 7 — Clean Run

**Status:** Implemented; clean official Web UI run passed

**Goal:** keep the exact verified materialization alive and open the official Harness Web UI.

**Tasks**

- Require `run --clean` and reject an implicit dirty run.
- Reuse the M4 materializer and M5 adapter start method.
- Print the official URL, PID/lifecycle status, and cleanup instructions.
- Implement graceful SIGINT/SIGTERM handling and no UI replacement.

**Dependencies:** M4 and M5.

**Tests:** verify/run pipeline identity; clean home; HTTP UI availability; graceful shutdown; source profile unchanged.

**Acceptance criteria:** `run --clean` starts the official Web UI from a frozen artifact and never invokes a special Reference Client path.

**Milestone record:** same ten-field report; `PRD Deviations: None`.

### Milestone 8 — Real-world Validation

**Status:** Planned; STOP AND REVIEW after completion

**Goal:** validate real reproducibility and decide whether Pack/Reference Client work is justified.

**Tasks**

- Exercise at least ten real Profiles/configurations.
- Detect at least three real failure categories before ordinary Harness startup.
- Run a cross-environment reconstruction and one non-developer sharing test.
- Record user preference against manual README/copy-folder setup.
- Perform the PRD GO/NO-GO review.

**Dependencies:** M0–M7.

**Tests:** real profile matrix, regression fixtures, cross-platform or platform-bound receipts.

**Acceptance criteria:** no false PASS, real clean-room PASS cases, useful receipt evidence, and a documented GO/NO-GO decision.

**Milestone record:** same ten-field report; `PRD Deviations: None` unless the review explicitly records one.

## Implementation log

### 2026-08-15 — Milestone 0 — Foundation

#### 1. Implementation Summary

Created the pnpm monorepo, TypeScript source layout, CLI grammar, stable exit codes, stage/error types, secret redaction, safe YAML parsing, and the named `StackMaterializer` seam.

#### 2. Files Changed

Root manifests/configuration, `packages/core`, `packages/cli`, tests, fixture inventory, and this plan.

#### 3. Architecture Decisions

The CLI delegates all Harness behavior through `SourceHarnessAdapter` and invokes the official CLI as a subprocess. DSH Stack owns metadata, integrity, diagnostics, and lifecycle only.

#### 4. Tests Added

Parser, path traversal, redaction, safe YAML, integrity, and stage/error foundation tests.

#### 5. Test Results

`pnpm typecheck` passed; `pnpm test` passed with 14 tests.

#### 6. Failure Fixtures Added

The PRD-required fixture inventory and scenario metadata were added; negative behavior is being wired into the preflight and integrity tests.

#### 7. Known Limitations

No compiled standalone binary or packaged runtime exists yet; development uses `tsx`.

#### 8. Security Boundaries

Secret values are redacted and high-confidence values block Freeze. Runtime subprocesses are not a security sandbox.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Ready for real Harness inspection and preflight.

### 2026-08-15 — Milestone 1 — Harness Inspection

#### 1. Implementation Summary

The adapter detected the source checkout, exact CLI version, root package manager requirement, observed toolchain, DSH home, Profile-owned inputs, generated root, fallback module directory, bundle declarations, and official Web UI launch contract.

#### 2. Files Changed

`packages/core/src/source-adapter.ts`, adapter types, CLI inspect output, and the audit section above.

#### 3. Architecture Decisions

Profile ownership is discovered by walking the Profile while excluding Harness-generated and runtime residue; `cordis.yml` is not copied. Bundle resolution is delegated to Node resolution anchored at the official Harness installation and Profile.

#### 4. Tests Added

Real `inspect --json` run against `~/.dsh/profiles/web`; fixture-based preflight setup tests.

#### 5. Test Results

The real web Profile reported `CONSISTENT`, both official bundles resolved, and no secret values were detected.

#### 6. Failure Fixtures Added

`missing-package`, `dangling-bundle`, and `duplicate-runtime-package` scenario records.

#### 7. Known Limitations

Installed-binary discovery is supported as a narrow fallback; a published binary without a source checkout cannot yet be frozen into a self-contained runtime.

#### 8. Security Boundaries

Inspection is read-only for the source Profile; no profile initialization or plugin installation occurs.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Ready for consistency, portability, and secret preflight.

### 2026-08-15 — Milestone 2 — Preflight

#### 1. Implementation Summary

Implemented lockfile/importer checks, dependency-source portability checks, bundle declaration checks, Cordis patch structure checks, and high-confidence secret blocking.

#### 2. Files Changed

`SourceHarnessAdapter.preflight`, error taxonomy, and preflight tests.

#### 3. Architecture Decisions

The lockfile is required when the Profile declares external dependencies. The official lock-free vanilla Profile is accepted without manufacturing a lockfile.

#### 4. Tests Added

Broken lockfile absence, local link, floating Git reference, bare Profile metadata, and secret-value fixtures.

#### 5. Test Results

Preflight tests pass; the real web Profile remains `CONSISTENT` with zero external Profile dependencies.

#### 6. Failure Fixtures Added

`broken-lockfile`, `non-portable-local-link`, `git-floating-reference`, `bad-cordis-patch`, and `missing-secret` scenario records.

#### 7. Known Limitations

The current static Cordis parser rejects JavaScript-tagged patch documents instead of preserving their syntax for a non-executing structural check; this is a hardening item before accepting complex real Profiles.

#### 8. Security Boundaries

Static checks never evaluate `!!js`; runtime verification explicitly executes third-party code later.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

The healthy reference Profile is eligible for normal Freeze.

### 2026-08-15 — Milestone 3 — Freeze

#### 1. Implementation Summary

Generated `examples/reference` through the standard Freeze command with `stack.yaml`, selected Profile inputs, deterministic smoke tests, and `stack.integrity.json`.

#### 2. Files Changed

`packages/core/src/freeze.ts`, integrity code, and `examples/reference/*`.

#### 3. Architecture Decisions

The Stack manifest records distribution metadata and exact pins; it does not duplicate the Harness dependency graph or include `node_modules`, `cordis.yml`, sessions, or credentials.

#### 4. Tests Added

Deterministic integrity generation and tamper detection tests.

#### 5. Test Results

Freeze passed for the official web Profile; source and copied PRD SHA-256 values remain identical.

#### 6. Failure Fixtures Added

`tampered-stack` scenario record.

#### 7. Known Limitations

Freeze stores the exact Harness version and source commit as evidence in the command result/receipt, but the artifact does not yet contain a distributable Harness runtime.

#### 8. Security Boundaries

Only adapter-selected Profile-owned files are copied; secret detection cannot be bypassed with `--force`.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Ready for clean materialization.

### 2026-08-15 — Milestone 4 — Materializer

#### 1. Implementation Summary

Implemented one named `StackMaterializer` used by both Verify and Run. It creates a temporary DSH home, copies exact Profile inputs, performs strict frozen install when needed, and leaves generated files to the official CLI.

#### 2. Files Changed

`packages/core/src/materializer.ts`, `verify.ts`, and `run.ts`.

#### 3. Architecture Decisions

The vanilla Profile skips install only because it declares no external dependencies and no lockfile; no lockfile is generated and no source `node_modules` is reused.

#### 4. Tests Added

Real clean materialization through the Verify and Run commands; lifecycle cleanup checks.

#### 5. Test Results

The reference artifact materialized in a new temporary DSH home and the official CLI recreated `cordis.yml`.

#### 6. Failure Fixtures Added

`missing-package` and `broken-lockfile` are represented in preflight/materializer paths.

#### 7. Known Limitations

External dependency installation has not yet been exercised against a real third-party Profile in this checkout.

#### 8. Security Boundaries

Credential environment variables are removed from core verification; third-party install/boot code still runs with the host process permissions.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Ready for static and runtime verification.

### 2026-08-15 — Milestone 5 — Verification

#### 1. Implementation Summary

Implemented schema/integrity/platform/version checks, official Web UI readiness, generated-root evidence, deterministic no-LLM core checks, and explicit `--live` UNSUPPORTED behavior.

#### 2. Files Changed

`packages/core/src/verify.ts`, CLI dispatch, receipt types, and smoke metadata.

#### 3. Architecture Decisions

Runtime proof is HTTP readiness of the official Harness Web UI plus generated Profile evidence; it does not turn a real LLM response into a deterministic core check.

#### 4. Tests Added

Foundation tests plus the real reference Verify run.

#### 5. Test Results

Reference Verify returned `PASS` in `runtime` level in a fresh DSH home; `llm:false`, `cacheUsed:false`, and localhost-only network evidence were recorded.

#### 6. Failure Fixtures Added

`unsupported-platform`, `plugin-activation-failure`, and `tampered-stack` scenario records.

#### 7. Known Limitations

The current adapter uses the exact source checkout supplied by `--harness`; it does not yet reconstruct the Harness installation itself from a registry/archive.

#### 8. Security Boundaries

The temporary home is reproducibility isolation, explicitly not a secure sandbox or malware barrier.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Ready to treat the receipt as a first-class artifact and to test receipt invalidation.

### 2026-08-15 — Milestone 6 — Receipt

#### 1. Implementation Summary

Implemented `verification.receipt.json` with exact Stack integrity, environment/toolchain, Harness version/commit, stage events, checks, no-live-LLM policy, and diagnostics.

#### 2. Files Changed

Receipt types, persistence, CLI JSON output, and `examples/reference/verification.receipt.json`.

#### 3. Architecture Decisions

Receipts are excluded from the artifact hash so writing evidence does not invalidate the artifact it proves; the receipt binds to `stack.integrity.json`'s artifact hash instead.

#### 4. Tests Added

Integrity tests and real receipt inspection.

#### 5. Test Results

Receipt for the reference Stack is `PASS`, `runtime`, `cacheUsed:false`, `thirdPartyCodeExecuted:true`, and `externalServices.llm:false`.

#### 6. Failure Fixtures Added

Receipt failure taxonomy is wired for tamper, unsupported platform, Harness mismatch, boot, and install paths.

#### 7. Known Limitations

Receipt schema validation is currently TypeScript-level plus required-field parsing, not a separately published JSON Schema package.

#### 8. Security Boundaries

Receipt and captured diagnostics use sanitized output; absolute local paths may still appear as operational diagnostics and are not credentials.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Ready for clean long-running Run.

### 2026-08-15 — Milestone 7 — Clean Run

#### 1. Implementation Summary

Implemented `run <stack> --clean` on the same `StackMaterializer` and official Web UI start path.

#### 2. Files Changed

`packages/core/src/run.ts` and CLI run dispatch.

#### 3. Architecture Decisions

Run keeps the official UI process alive and owns graceful SIGINT/SIGTERM teardown; it does not introduce a client UI or a bypass for Reference Client work.

#### 4. Tests Added

Real run command with a fixed local port, HTTP readiness, Ctrl-C teardown, and process cleanup inspection.

#### 5. Test Results

`run --clean` served the official Harness HTML at `http://127.0.0.1:3191` and exited cleanly after SIGINT with no lingering Harness process.

#### 6. Failure Fixtures Added

Run reuses the materializer and boot failure fixtures; no special Reference Client fixture exists.

#### 7. Known Limitations

Run currently accepts a valid Stack before requiring a prior PASS receipt; Package will require Runtime PASS as specified by the PRD.

#### 8. Security Boundaries

Run inherits the host permissions of the official Harness process; `--clean` is not a security sandbox.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Core path is ready for expanded real-world validation and the mandatory GO/NO-GO review before Package.

## Reference Distribution track

This track starts only after the core Freeze/Verify/Reproduce chain is real. It is still a required final acceptance case, not a shortcut.

### Package and Reference Client

**Tasks**

1. Add `dsh-stack package <verified-stack>` with a generic runtime bundle path shared by all Stack artifacts.
2. Require a valid Runtime PASS receipt or run Runtime Verify through the existing pipeline.
3. Bundle a private Node runtime, exact Harness installation, exact Profile inputs, and the official Web UI; do not depend on system Node, pnpm, DSH CLI, or a user's Profile.
4. Generate a generic AppKit/WebKit Native Shell for lifecycle, secret onboarding, diagnostics, OS integration, and hosting the official UI in its own window; never hand the URL to the default browser.
5. Keep `DEEPSEEK_API_KEY` and all other secret values outside the artifact and do not inject them into the inherited Harness environment; delegate editable storage and hot reload to the official `credentials-local` provider in the private `DSH_HOME`.
6. Produce a macOS `.app`/`.dmg` only after the platform runtime and signing/notarization strategy are validated; do not claim an installable client from a zip of source files.

**Dependencies:** M8 GO review, M4 materializer, M5 verifier, M6 receipt, and a concrete runtime bundling strategy.

**Tests:** package rejects missing/invalid receipt; packaged runtime starts from a fresh user home; no system Node/pnpm/CLI; official UI loads; restart works; secret never appears in artifact/logs.

**Acceptance criteria:** a non-developer on a machine without the Profile can Download → Install → Open → configure API key → enter official Harness Web UI → complete one real Agent Session, with no Terminal intervention.

**UAT document:** `docs/reference-distribution-uat.md` must record tester, clean-machine assumptions, exact installer hash, steps, observed results, screenshots/log references, and any developer intervention. Any intervention is UAT FAIL.

### 2026-08-15 — Reference Distribution Package checkpoint

#### 1. Implementation Summary

Added generic `dsh-stack package <stack>` support. It validates the current Runtime PASS receipt, deploys the official `@deepseek-ai/dsh` production closure with pnpm, fills missing official workspace/vendor peer packages from the Harness checkout, embeds a self-contained Node runtime and its non-system macOS dylibs, copies the frozen Profile, and creates an ad-hoc signed `.app` with a compiled AppKit/WebKit Native Shell.

#### 2. Files Changed

`packages/core/src/package-client.ts`, `packages/core/assets/ReferenceShell.swift`, `packages/core/assets/reference-client.mjs`, `packages/core/assets/Info.plist`, `packages/core/tests/reference-client.test.ts`, CLI package dispatch, CI workflow, README, and `docs/reference-distribution-uat.md`.

#### 3. Architecture Decisions

The client owns only the Native Shell window, lifecycle, Keychain/API-key onboarding, private DSH home, and runtime bootstrap. WKWebView loads the URL emitted by the packaged runtime bootstrap; the official Harness `lib/bin.js` and official Web UI remain the runtime. Package is generic over Stack metadata; there is no Reference-only hardcoded Profile or Agent path.

#### 4. Tests Added

Package closure smoke iterations, macOS dynamic-library closure checks, ad-hoc signature verification, and clean-environment client launch checks.

#### 5. Test Results

The corrected generated client is `dist/reference-client/DSH Stack Reference v8.app` (ad-hoc signed, x86_64). Its main executable is Mach-O rather than a shell script. With `PATH=/usr/bin:/bin`, no system Node/pnpm/DSH CLI, and a test-only key, it opened a real `DSH Stack Reference — DeepSeek Harness` Native Shell window containing the official Harness UI; no external browser handoff occurred. The embedded client stopped cleanly, and the Runtime PASS receipt/integrity hash remained unchanged.

#### 6. Failure Fixtures Added

Package failures were observed and repaired in sequence: missing `libnode.147.dylib`, missing transitive macOS dylibs, missing official vendor/workspace peers, then successful v5/v6 closure launches. These are documented as regression evidence rather than PASS fixtures.

#### 7. Known Limitations

The client is ad-hoc signed, not Apple Developer signed/notarized; the final Download/Install gate on a separate non-developer Mac remains open. The first-launch API-key prompt and one real Agent turn were not executed because no live credential and non-developer tester were supplied. The generated client is currently macOS x64 only and larger than a production-optimized distribution.

#### 8. Security Boundaries

Secret values are not copied into the Stack or `.app`; the shell reads the required key from environment/Keychain or a hidden native prompt and passes it only to the Harness process. Ad-hoc signing is integrity evidence, not publisher trust.

#### 9. PRD Deviations

The initial v6 Reference Client handed the local URL to the default browser, which was a PRD deviation. v8 corrects this with the generic AppKit/WebKit Native Shell; the current implementation has no remaining deviation in this area.

#### 10. Readiness for Next Milestone

The corrected Native Shell Reference Client path is runnable. Product E2E completion still requires the manual UAT in `docs/reference-distribution-uat.md`, a real API key, a separate clean Mac, and the PRD's STOP AND REVIEW/GO decision.

### 2026-08-15 — Editable credential correction

#### 1. Implementation Summary

Corrected the Reference Client credential boundary after UAT exposed that the Native Shell read a Keychain value and injected it as `DEEPSEEK_API_KEY`. The official Harness deliberately marks inherited environment credentials read-only. The Native Shell now removes Stack-declared secret names from the child environment and lets the official `credentials-local` provider own the writable credential document and hot reload.

#### 2. Files Changed

`packages/core/assets/ReferenceShell.swift`, `packages/core/assets/reference-client.mjs`, `packages/core/tests/reference-client.test.ts`, `README.md`, `docs/reference-distribution-uat.md`, and this plan.

#### 3. Architecture Decisions

The Reference Client owns runtime lifecycle and the Native Shell window only. It does not own a second credential system and does not copy a Keychain value into the Harness environment. The official Models page writes `$DSH_HOME/.credentials.yaml`; the official DeepSeek adapter resolves that credential on each request.

#### 4. Tests Added

Added a regression test asserting that the Native Shell and runtime bootstrap remove Stack-declared API-key environment values, use the official readiness handshake, and never call the default browser or Keychain.

#### 5. Test Results

Typecheck, the full local suite, and the real Harness integration suite pass after the correction. Packaged v9 is a signed x86_64 Mach-O client; when launched with an intentionally invalid inherited key, the Harness child process contained no `DEEPSEEK_API_KEY`, and the Native Shell displayed the official editable “Add an API Key” form. A real key save and Agent turn remain part of manual UAT.

#### 6. Failure Fixtures Added

The reported failure is recorded as a regression case: inherited `DEEPSEEK_API_KEY` makes the official Models field read-only and remains stale after an invalid key. The corrected path removes that inherited layer.

#### 7. Known Limitations

The credential document is protected by the official Harness owner-only file policy, not macOS Keychain. Apple Developer signing/notarization, a separate clean-Mac UAT, and a real key remain release gates.

#### 8. Security Boundaries

The Stack artifact contains only secret names. The Native Shell removes those names from the runtime environment. Secret values are handled by the official credentials provider and are never logged, committed, or embedded in the `.app`.

#### 9. PRD Deviations

The v8 Keychain-to-environment injection was a deviation because it prevented the ordinary user from changing a credential in the official UI. v9 corrects it; the current implementation has no remaining deviation for editable credential ownership.

#### 10. Readiness for Next Milestone

Ready for packaged v9 black-box validation: enter a valid key in Models, complete a real Agent turn, replace an invalid key without restart, and verify restart persistence.

### 2026-08-15 — Native Shell paste correction

#### 1. Implementation Summary

UAT exposed a second Native Shell defect: typing into the official Models field worked, but `⌘V` did nothing. The official Harness does not disable paste; its provider editor uses a normal password input and its credential model has explicit pasted-value handling. The defect was the minimal AppKit shell not installing a standard macOS Edit menu/responder route. The shell now exposes Undo, Redo, Cut, Copy, Paste, and Select All while leaving the official Harness Web UI and credential ownership unchanged.

#### 2. Files Changed

`packages/core/assets/ReferenceShell.swift`, `packages/core/tests/reference-client.test.ts`, `docs/reference-distribution-uat.md`, and this plan.

#### 3. Architecture Decisions

The fix stays at the Native Shell boundary: it registers the standard AppKit application menu so the focused official `WKWebView` receives the platform paste action. It does not add a custom key field, clipboard bridge, JavaScript injection, or second credential system.

#### 4. Tests Added

Added a static regression assertion that the shell installs the application menu and registers the `paste:` action. The manual black-box UAT now has an explicit paste acceptance row and requires `⌘V` or `Edit → Paste`.

#### 5. Test Results

Swift typecheck passed. `pnpm typecheck` passed. `pnpm test` passed with 15/15 tests. The generated v10 x86_64 app was launched with a clipboard-only test value; `⌘V` inserted the value into the official password field, rendered as bullet characters, and the macOS `Edit` menu was visible. No real API key was used in this regression test.

#### 6. Failure Fixtures Added

The v9 behavior is retained as regression evidence: a focused official password field remained empty after `⌘V` because the Native Shell had no standard Edit menu. This is a shell integration failure, not an official Harness paste restriction.

#### 7. Known Limitations

The current artifact is ad-hoc signed and x86_64; Apple Developer signing/notarization, clean-Mac installation, a real key, and one real Agent turn remain release gates. The paste test proves clipboard routing with a synthetic value, not provider authentication.

#### 8. Security Boundaries

The shell only enables normal AppKit responder actions for the focused official WebView. It does not log, inspect, or persist clipboard contents. Real API-key storage remains in the official Harness credentials provider.

#### 9. PRD Deviations

None. The missing Edit menu was an implementation defect in the Native Shell and is corrected without changing the PRD product boundary.

#### 10. Readiness for Next Milestone

Ready for manual UAT on v10: paste a real key, save it, complete one real Agent turn, replace an invalid key without restart, and verify restart persistence.

### 2026-08-16 — Reference RC closure and macOS release engineering

#### 1. Implementation Summary

Closed the x86_64 single-machine Reference RC loop with real credential-backed Agent turns and restart persistence, while keeping the public `v0.1.0-reference-v10` release explicitly Reference / RC rather than Stable. Added architecture-aware Package controls, a standard macOS DMG release script, optional Developer ID/Hardened Runtime/notarization hooks, and a native x64/arm64 GitHub Actions build matrix. The package script still executes Freeze → Verify → Materialize → Package; it does not create an architecture-specific client shortcut or a second Harness path.

#### 2. Files Changed

`packages/core/src/package-client.ts`, `packages/cli/src/main.ts`, `packages/cli/tests/cli.test.ts`, `scripts/build-macos-reference.sh`, `.github/workflows/macos-reference.yml`, `README.md`, `docs/reference-distribution-uat.md`, and this plan.

#### 3. Architecture Decisions

Package target architecture is explicit (`x64` or `arm64`) and must be declared by the verified Stack. A cross-architecture package requires an explicit matching Node runtime; native runners use the host runtime. Separate x86_64 and arm64 artifacts are preferred over an unverified Universal binary. Signing identity and notary profile are external inputs; absent credentials produce a visible ad-hoc/PENDING result, never a false formal-release PASS.

#### 4. Tests Added

Added CLI parser coverage for target architecture, explicit Node runtime, signing identity, Hardened Runtime, and invalid architecture rejection. Added shell syntax validation for the DMG/release script.

#### 5. Test Results

`pnpm typecheck` passed; `pnpm test` passed with 17/17 tests. The new x86_64 release script performed Freeze, Runtime Verify PASS, Package, App launch, official Harness UI load, real Agent turn, DMG creation, and `hdiutil verify` successfully on 2026-08-16 Asia/Shanghai. After v10 termination/relaunch, a real `RESTART_PASS` turn completed. The fresh x86_64 DMG SHA-256 is recorded in its generated sidecar.

#### 6. Failure Fixtures Added

The earlier invalid-key session with `401 AUTH` remains explicit failure evidence. No arm64 PASS fixture was created; missing native arm64 execution remains a real pending state.

#### 7. Known Limitations

The current machine is Intel x86_64, so native arm64 Freeze/Verify/Package/App/Agent evidence cannot be produced locally. The current signing identity is Apple Development, not Developer ID Application. No clean non-developer Mac has been tested. Invalid-key replacement without restart remains unverified.

#### 8. Security Boundaries

The release script never reads or prints credential values. The official credentials provider remains the owner of the private credential document. Notary credentials are referenced by an external keychain profile only and are never committed or placed in Release assets.

#### 9. PRD Deviations

None. The public `v0.1.0-reference-v10` artifact remains a Reference / RC pre-release because the PRD's clean-machine and formal distribution gates are not yet satisfied.

#### 10. Readiness for Next Milestone

Ready for native arm64 runner execution and Developer ID/notarization credential injection. Not ready to create formal Stable `v0.1.0`.

### 2026-08-16 — Release pipeline hang correction and native arm64 packaging

#### 1. Implementation Summary

Resolved the long-running macOS CI failure without changing the PRD product boundary. The failure was not in Package: the official Harness Web process tree survived `Verify` on the arm64 runner, so the CLI printed `PASS` but the Verify command never returned. The materializer now starts the official process in a POSIX process group and terminates the whole group during Verify cleanup. The macOS package fallback now follows the deployed package manifests' dependency, optional-dependency, and peer-dependency graph, copying only missing official workspace packages instead of scanning and copying the entire workspace closure. Release scripts now expose phase timestamps and optional package tracing, and the workflow has a bounded 30-minute job timeout.

#### 2. Files Changed

`packages/core/src/materializer.ts`, `packages/core/src/package-client.ts`, `scripts/build-macos-reference.sh`, `.github/workflows/macos-reference.yml`, `README.md`, `README.zh-CN.md`, `docs/reference-distribution-uat.md`, and this plan.

#### 3. Architecture Decisions

The official Harness remains the only runtime and Web UI. Process-group cleanup changes lifecycle ownership only; it does not replace the Agent Loop or Web server. Package still follows `Freeze → Verify → Materialize → Package`, and the dependency fallback copies only official packages required by the deployed graph. The arm64 Release assets are produced on a native arm64 runner and uploaded from that runner, avoiding a separate local artifact-transfer path.

#### 4. Tests Added

Added package phase tracing, bounded macOS CI execution, native runner package flow, and opt-in direct upload of arm64 DMG/receipt/SHA assets to the existing Reference Release. Existing CLI/package architecture coverage remains in place.

#### 5. Test Results

`pnpm typecheck` passed; `pnpm test` passed with 17/17 tests; shell syntax validation passed. A fresh local x86_64 release run reached `Verify completed`, packaged the App, passed `codesign --verify --deep --strict`, created the DMG, and passed `hdiutil verify`. The local packaged App loaded the official Harness UI and completed `TARGETED_PACKAGE_PASS`. GitHub Actions run `31899143451` completed native arm64 Freeze, Verify, Materialize, Package, DMG creation, artifact upload, and direct upload of the three arm64 Release assets. The published arm64 receipt is Runtime `PASS`, `cacheUsed: false`, `environment.arch: arm64`, with Harness `0.1.0-rc.5` at commit `47f943859bef60e4160492346772ded9b24f765a`.

#### 6. Failure Fixtures Added

The cancelled run `31897333474` remains failure evidence: the arm64 log reached `RESULT / PASS` but never emitted `Verify completed` until cancellation. The earlier broad-closure behavior and the original missing-built-Harness-package failure remain regression evidence. No arm64 Live Agent PASS is fabricated from packaging-only CI.

#### 7. Known Limitations

The arm64 App has been natively built and packaged but not manually launched on an Apple Silicon Mac; arm64 Live Agent E2E and arm64 clean-machine UAT remain pending. Universal binary is not produced. The current Release artifacts are ad-hoc signed. Developer ID Application signing, Hardened Runtime release signing, notarization, and stapling remain blocked by missing external Apple credentials.

#### 8. Security Boundaries

The process-group termination is limited to the official Harness child process group created by the Stack verifier. Package tracing contains phase names and package names only; it never reads or prints secret values. Release upload uses GitHub Actions' scoped token and publishes only App distribution artifacts, SHA-256, and sanitized verification receipts.

#### 9. PRD Deviations

None.

#### 10. Readiness for Next Milestone

Reference / RC packaging is ready for both x86_64 and arm64 assets. Stable `v0.1.0` is not ready until arm64 App/Live Agent UAT, clean-machine coverage for the supported architectures, and Developer ID signing/notarization/stapling are complete.

## Regression fixture inventory

The fixture names are PRD-required and each must have a test asserting it cannot produce a false PASS:

```text
healthy-profile
broken-lockfile
missing-package
dangling-bundle
bad-cordis-patch
duplicate-runtime-package
plugin-activation-failure
non-portable-local-link
git-floating-reference
missing-secret
unsupported-platform
tampered-stack
```

Fixtures are synthetic until real community failures are collected; synthetic fixtures must remain minimal and must not be presented as real-world evidence.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | PASS / successful command |
| 1 | Verification or runtime FAIL |
| 2 | UNSUPPORTED environment or capability |
| 3 | INVALID INPUT / schema / CLI usage |
| 4 | INTERNAL ERROR |

## Per-milestone record template

Each completed milestone appends a dated record with exactly these headings:

1. Implementation Summary
2. Files Changed
3. Architecture Decisions
4. Tests Added
5. Test Results
6. Failure Fixtures Added
7. Known Limitations
8. Security Boundaries
9. PRD Deviations
10. Readiness for Next Milestone

The default value of **PRD Deviations** is `None`. The current known lockfile absence for the vanilla web Profile is an adapter interpretation of the existing Harness behavior, not a product-contract deviation.
