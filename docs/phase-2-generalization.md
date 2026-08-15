# Phase 2 — Real-world Profile Generalization

Phase 2 validates the current DSH Stack contract against real public DeepSeek Harness bundles outside this repository. It does not attempt to become a universal Agent runtime.

## Locked architecture boundary

**No ecosystem accumulation in runtime artifacts.** Supporting more Profiles must grow generic `HarnessAdapter` capability, Preflight and compatibility rules, verification logic, failure fixtures, and tests—not the contents of every generated App.

```text
App Artifact = Base Runtime + Exact Harness Closure + Current Profile Closure
```

The generated App for Profile A must not contain Profile B, Profile C, or all known plugins. Phase 2 does not add a shared Runtime Manager, global plugin repository, Marketplace, Registry, or Studio.

## Execution order

```text
Research
→ Profile Selection
→ Compatibility Matrix
→ Run Pipeline
→ Diagnose Failures
→ Generalize Core
→ Regression Fixtures
→ Re-run
→ Package
→ External UAT
→ Final Review
```

The per-Case pipeline is always:

```text
Inspect → Preflight → Freeze → Verify / Prove → Reproduce → Package
```

`Verify` and `run --clean` call the same `StackMaterializer`; Package materializes the same exact Profile closure before embedding it. No Profile name or repository name is used in core business branching.

## Milestones and records

### M2.0 — Research and selection

- Implementation Summary: selected public external bundles from GitHub and recorded the exact commit, package shape, Harness-version claim, dependencies, patch/bundle structure, and portability risks.
- Files Changed: this document, [`phase-2-compatibility-matrix.md`](./phase-2-compatibility-matrix.md), [`phase-2-compatibility-matrix.json`](./phase-2-compatibility-matrix.json).
- Architecture Decisions: test both standalone/custom Profiles and the real documented pattern of installing an external bundle into the official `web` Profile.
- Tests Added: source and package-shape inspection is captured in the matrix.
- Test Results: 8 external repositories/cases researched; 5 Web-compatible cases reached Runtime PASS.
- Failure Fixtures Added: [`fixtures/phase2-real-lock-proof-activation`](../fixtures/phase2-real-lock-proof-activation), [`fixtures/phase2-unbuilt-bundle-entry`](../fixtures/phase2-unbuilt-bundle-entry), [`fixtures/phase2-workspace-link`](../fixtures/phase2-workspace-link).
- Known Limitations: community HEADs are time-sensitive; every case is frozen to a full commit SHA in the matrix.
- Security Boundaries: third-party code was executed only in disposable `DSH_HOME` materializations; no credentials were copied into test homes.
- PRD Deviations: None.
- Readiness for Next Milestone: complete.

### M2.1 — Generic adapter and Preflight

- Implementation Summary: bundle-directory resolution now accepts configuration-only bundles without `main`; Preflight checks lockfile specifiers, duplicate runtime packages, platform-targeted direct dependencies, Cordis references, missing build entries, lifecycle scripts, secret inputs, and generated/user-data exclusions.
- Files Changed: `packages/core/src/source-adapter.ts`, `packages/core/src/types.ts`, `packages/core/tests/inspection.test.ts`, `packages/core/tests/preflight.test.ts`.
- Architecture Decisions: inspect package metadata and package directories, not only Node's executable `main` resolution; unresolved patch references remain a hard diagnostic.
- Tests Added: no-main bundle, lockfile mismatch, duplicate runtime, dangling reference, missing entry, link/floating Git, and secret tests.
- Test Results: `pnpm typecheck` PASS; `pnpm test` PASS (22/22 after the Phase 2 size-report and exclusion tests are included).
- Failure Fixtures Added: [`fixtures/phase2-config-only-bundle`](../fixtures/phase2-config-only-bundle), [`fixtures/phase2-generated-data-exclusion`](../fixtures/phase2-generated-data-exclusion).
- Known Limitations: Cordis patches containing `!!js` are intentionally not evaluated statically; they receive an explicit warning and must be proven by Runtime Verify.
- Security Boundaries: no JavaScript tag is evaluated by static inspection; secret values remain fail-closed; all diagnostics redact command output.
- PRD Deviations: None.
- Readiness for Next Milestone: complete.

### M2.2 — Unified materialization and packaging closure

- Implementation Summary: Verify/Run boot the exact Stack Profile; Package materializes and embeds the exact Profile `node_modules` closure; App storage uses the artifact hash; `--size-report` reports closure categories.
- Files Changed: `packages/core/src/materializer.ts`, `packages/core/src/package-client.ts`, `packages/core/assets/reference-client.mjs`, `packages/core/src/package-size-report.ts`, `packages/cli/src/main.ts`, `scripts/build-macos-reference.sh`.
- Architecture Decisions: keep the official Harness runtime single and shared only inside one App; keep each App self-contained and Profile-specific; write the size report beside the signed App so it cannot invalidate the code signature.
- Tests Added: exact Profile boot regression, App storage isolation assertions, size category test.
- Test Results: packaged external Apps launched with `DSH_STACK_READY`; `run --clean` PASS for netcafe and plugin-guide; external package closure was found under `Resources/profile/node_modules` and not under the Harness runtime.
- Failure Fixtures Added: the real activation/build/link fixtures above.
- Known Limitations: package output remains ad-hoc signed until Apple Developer credentials are supplied; no Universal binary is claimed.
- Security Boundaries: profile dependencies are copied from a clean frozen install with dereferenced links; tests, caches, and user data are not copied as Profile inputs.
- PRD Deviations: None.
- Readiness for Next Milestone: complete for x86_64; arm64 external Profile packaging still requires a native arm64 run.

### M2.3 — Compatibility re-run

- Implementation Summary: re-ran Inspect → Preflight → Freeze → Verify → `run --clean` → Package for the compatible cases and preserved real failures without case-specific patches.
- Files Changed: [`phase-2-compatibility-matrix.json`](./phase-2-compatibility-matrix.json), [`phase-2-compatibility-matrix.md`](./phase-2-compatibility-matrix.md), [`package-size-report.json`](./package-size-report.json).
- Architecture Decisions: statuses are only `PASS`, `FAIL`, `UNSUPPORTED`, or `INCOMPLETE`; Runtime PASS does not imply Live Agent PASS.
- Tests Added: matrix evidence and external package-closure checks.
- Test Results: see the matrix; 5 external Web bundles reached Runtime + Package PASS; one third-party activation failure and two non-portable/build failures remain explicit.
- Failure Fixtures Added: all new real-world failure modes are represented under `fixtures/phase2-*`.
- Known Limitations: external clean-machine UAT and real Agent turns for a non-official Profile were not performed.
- Security Boundaries: no false Live Agent PASS; remote MCP/network behavior is not claimed by localhost UI health.
- PRD Deviations: None.
- Readiness for Next Milestone: External UAT is the remaining gate.

### M2.4 — External UAT and final review

- Implementation Summary: pending an independent clean machine and API credential for a non-official Profile.
- Files Changed: [`PHASE_2_REVIEW.md`](../PHASE_2_REVIEW.md) will record the final gate result.
- Architecture Decisions: keep the gate explicit rather than treating developer-machine App launch as clean-machine proof.
- Tests Added: manual UAT only; no test is marked PASS before evidence exists.
- Test Results: `INCOMPLETE` for external clean-machine and Live Agent validation.
- Failure Fixtures Added: None beyond the real failures already recorded.
- Known Limitations: Apple signing/notarization remains the separate release blocker from Phase 1.
- Security Boundaries: API keys must be entered by the tester and never stored in the repository or fixture output.
- PRD Deviations: None.
- Readiness for Next Milestone: STOP AND REVIEW; do not begin Registry / Marketplace / Studio.

## Reproduction commands

Use a disposable `DSH_HOME` and the pinned official Harness checkout:

```sh
pnpm dsh-stack inspect --profile web --dsh-home "$DSH_HOME" --harness ../deepseek-harness --json
pnpm dsh-stack freeze --profile web --dsh-home "$DSH_HOME" --harness ../deepseek-harness --output /tmp/stack
pnpm dsh-stack verify /tmp/stack --harness ../deepseek-harness --json
pnpm dsh-stack run /tmp/stack --clean --harness ../deepseek-harness
pnpm dsh-stack package /tmp/stack --harness ../deepseek-harness --arch x64 --size-report --output /tmp/Reference.app
```

`--size-report` writes `<App-name>-package-size-report.json` next to the App. Set `DSH_STACK_SIZE_BASELINE_BYTES` to emit a non-blocking warning when the total exceeds the baseline by more than 10%.
