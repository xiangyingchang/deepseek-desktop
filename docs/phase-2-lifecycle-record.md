# Phase 2 Lifecycle Milestone Record

Date of this record: 2026-08-16. `PASS` below means the stated scope was actually executed; `INCOMPLETE` is deliberately not promoted to PASS.

## M1 — Architecture Freeze

1. **Implementation Summary:** Added the authoritative Base / Derived / Candidate / Shareable lifecycle Contract to PRD §140 and this plan.
2. **Files Changed:** `PRD.md`, `IMPLEMENTATION_PLAN.md`, `docs/phase-2-lifecycle.md`.
3. **Architecture Decisions:** Profile remains Composition Source of Truth; no runtime ecosystem accumulation.
4. **Tests Added:** Documentation and source-boundary review.
5. **Test Results:** PASS; `git diff --check` and typecheck pass.
6. **Failure Fixtures Added:** None.
7. **Known Limitations:** Existing historical PRD sections remain as history and are superseded by §140 where they conflict.
8. **Security Boundaries:** No credentials or user state are introduced into metadata.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M2 — State Model

1. **Implementation Summary:** Added `DistributionManifest` metadata, stable App data identity, Base snapshot and lifecycle state file.
2. **Files Changed:** `packages/core/src/types.ts`, `distribution.ts`, `freeze.ts`, `package-client.ts`, `assets/reference-client.mjs`.
3. **Architecture Decisions:** `distribution.yaml` is metadata only; no `bundledPlugins` field exists.
4. **Tests Added:** Distribution receipt and packaged client asset assertions; lifecycle tests.
5. **Test Results:** PASS in `pnpm typecheck` and `pnpm test`.
6. **Failure Fixtures Added:** `phase2-user-plugin-preservation`.
7. **Known Limitations:** Existing pre-lifecycle installations without a stored Base snapshot establish a conservative baseline on first launch.
8. **Security Boundaries:** Base snapshot excludes generated/user-state paths; API keys remain Harness-owned.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M3 — Drift Detection

1. **Implementation Summary:** Added deterministic Profile-owned file drift detection and `dsh-stack drift`.
2. **Files Changed:** `packages/core/src/rebase.ts`, `packages/cli/src/main.ts`.
3. **Architecture Decisions:** Drift compares inputs only and never edits either Profile.
4. **Tests Added:** Added/removed/modified inputs and generated/session exclusion tests.
5. **Test Results:** PASS; included in 28/28 automated tests.
6. **Failure Fixtures Added:** `phase2-user-plugin-preservation`.
7. **Known Limitations:** Drift is file/input-based; Harness-specific semantic interpretation remains in the adapter.
8. **Security Boundaries:** Credentials, sessions, caches and logs are excluded from comparison.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M4 — Derived Profile Local Verification

1. **Implementation Summary:** Added lifecycle identity to Runtime Receipts and verified a real Derived artifact through the official Harness.
2. **Files Changed:** `packages/core/src/verify.ts`, `types.ts`, `distribution.ts`.
3. **Architecture Decisions:** A Base Receipt is not reused as a Derived Receipt.
4. **Tests Added:** Distribution metadata validation and receipt binding checks.
5. **Test Results:** Real official `web` Freeze → Runtime Verify PASS; receipt integrity `sha256-f6ceba5407bf80e21355da0828e11cbc6327b3e37fd36e8fdfdfc52226f0902c`.
6. **Failure Fixtures Added:** Existing tampered-stack plus distribution schema path.
7. **Known Limitations:** Real external user Bundle Live Agent verification is incomplete because the upstream install path is blocked.
8. **Security Boundaries:** Runtime verification removes inherited API-key environment variables.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M5 — Distribution Rebase Engine

1. **Implementation Summary:** Added generic three-way Profile merge, JSON/YAML structured merge, additive bundle/dependency merge, and candidate Stack generation.
2. **Files Changed:** `packages/core/src/rebase.ts`, `packages/core/assets/profile-rebase.mjs`.
3. **Architecture Decisions:** Rebase does not compose Harness layers or resolve dependencies; it produces another standard Profile for the existing pipeline.
4. **Tests Added:** Independent user/Base additions and id-keyed Cordis patch rows.
5. **Test Results:** PASS; fixture and real derived config update candidate both merged correctly.
6. **Failure Fixtures Added:** `phase2-rebase-conflict`.
7. **Known Limitations:** Ambiguous non-structured files are blocked rather than heuristically merged.
8. **Security Boundaries:** User-state paths are not copied into a candidate.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M6 — Conflict Detection

1. **Implementation Summary:** Added `UPDATE_REBASE_CONFLICT` for same-value changes, delete-vs-new-Base requirements, and ambiguous ordered changes.
2. **Files Changed:** `packages/core/src/rebase.ts`, `types.ts`, CLI diagnostics.
3. **Architecture Decisions:** Conflict is safer than guessing user intent.
4. **Tests Added:** Same dependency changed to two versions; user removal versus Base addition.
5. **Test Results:** PASS; no output candidate is written on conflict.
6. **Failure Fixtures Added:** `phase2-rebase-conflict`.
7. **Known Limitations:** No graphical conflict editor in this phase.
8. **Security Boundaries:** Conflict reports contain paths/reasons, never secret values.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M7 — Verify-before-switch + Atomic Switch

1. **Implementation Summary:** Added candidate verification orchestration, same-filesystem atomic directory switch and `.previous` rollback preservation.
2. **Files Changed:** `packages/core/src/rebase.ts`, `packages/cli/src/main.ts`, `assets/reference-client.mjs`.
3. **Architecture Decisions:** The active Profile is not touched until Runtime Verify returns PASS.
4. **Tests Added:** Verify failure leaves active unchanged; success retains previous backup.
5. **Test Results:** PASS in automated tests and real official Harness update E2E.
6. **Failure Fixtures Added:** `phase2-atomic-switch`.
7. **Known Limitations:** Cross-filesystem active/staging paths are rejected by the OS rename boundary.
8. **Security Boundaries:** Old Profile remains available after a failed switch; no destructive cleanup of user data.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M8 — Maintainer Promote

1. **Implementation Summary:** Added explicit `dsh-stack promote` from a verified Working/Derived Stack to an immutable Candidate metadata state.
2. **Files Changed:** `packages/core/src/distribution.ts`, CLI.
3. **Architecture Decisions:** Promotion is manual and invalidates the old Receipt until Candidate Verify runs.
4. **Tests Added:** Promotion requires Runtime PASS and refuses existing output.
5. **Test Results:** Real official Derived → Candidate → Runtime Verify PASS.
6. **Failure Fixtures Added:** Existing verification-incomplete paths.
7. **Known Limitations:** Stable publication remains a separate release operation.
8. **Security Boundaries:** Promotion copies only the already frozen artifact and its Profile closure.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready for real third-party Bundle promotion.

## M9 — Built-in Plugin Promotion E2E

1. **Implementation Summary:** Generic promotion path is present; no Profile-specific branch was added.
2. **Files Changed:** Same M8 files.
3. **Architecture Decisions:** Official Harness must install/reconcile the Bundle; DSH Stack only freezes/verifies the result.
4. **Tests Added:** Generic additive Bundle fixture.
5. **Test Results:** Fixture PASS; real community Bundle install attempt INCOMPLETE because official `pnpm dsh plugin` hit its source production install/postinstall blocker.
6. **Failure Fixtures Added:** Existing Phase 2 external failure records plus the upstream install observation in `phase-2-lifecycle.md`.
7. **Known Limitations:** No false Live PASS for a third-party Bundle.
8. **Security Boundaries:** The failed upstream command was run in an isolated temporary DSH_HOME; local Harness dependencies were restored with frozen install.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Blocked on upstream source install behavior or a separately installed Harness distribution.

## M10 — User Plugin Update Preservation E2E

1. **Implementation Summary:** User Bundle additions merge through the generic engine; App runtime preserves stable data identity and Base snapshots.
2. **Files Changed:** Rebase core/runtime asset, package metadata.
3. **Architecture Decisions:** Stable `dsh-web` data identity replaces artifact-hash directory naming.
4. **Tests Added:** Bundle addition fixture and real App runtime custom-state update.
5. **Test Results:** Generic Bundle preservation PASS; real official UI update with independent user/Base Profile changes PASS; real third-party Bundle Live path remains INCOMPLETE.
6. **Failure Fixtures Added:** `phase2-user-plugin-preservation`.
7. **Known Limitations:** A pre-lifecycle App without a Base snapshot cannot reconstruct historical Base intent.
8. **Security Boundaries:** User credentials remain outside Profile Composition and are not copied into Stack artifacts.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Share path can proceed.

## M11 — Share This Setup

1. **Implementation Summary:** Added `.dshstack` Pack with Integrity/Receipt binding, allowlisted contents and secret/state scan.
2. **Files Changed:** `packages/core/src/share.ts`, CLI, fixtures.
3. **Architecture Decisions:** `.dshstack` is the default sharing artifact; standalone App is advanced.
4. **Tests Added:** Pack archive, state leak and bound receipt tests.
5. **Test Results:** Real official Stack Pack PASS.
6. **Failure Fixtures Added:** `phase2-share-secret-isolation`.
7. **Known Limitations:** Archive implementation uses host `zip`; Pack reports a clear error if unavailable.
8. **Security Boundaries:** API keys, credentials, sessions, personal files, caches and secret logs are rejected.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M12 — Import `.dshstack` E2E

1. **Implementation Summary:** Added safe archive listing, traversal/state rejection, extraction and Integrity verification.
2. **Files Changed:** `packages/core/src/share.ts`, CLI.
3. **Architecture Decisions:** Import never directly runs an unverified archive; the next step is the standard Verify command.
4. **Tests Added:** Real Pack → Import → Verify and archive path checks.
5. **Test Results:** Real official imported artifact Runtime Verify PASS with the same Integrity hash.
6. **Failure Fixtures Added:** Tampered Stack coverage applies to imported output.
7. **Known Limitations:** Cross-machine external UAT is pending.
8. **Security Boundaries:** Zip path traversal and user-state entries are blocked before extraction.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready.

## M13 — Standalone Package from Derived Profile

1. **Implementation Summary:** Package pipeline now embeds lifecycle metadata, stable client identity and the generic runtime Rebase asset.
2. **Files Changed:** `package-client.ts`, `reference-client.mjs`, `profile-rebase.mjs`.
3. **Architecture Decisions:** The App still hosts the official Harness UI and does not become a second runtime.
4. **Tests Added:** Runtime asset syntax and package closure checks.
5. **Test Results:** Real x86_64 App package, codesign verification and isolated official UI launch PASS; package-size report generated.
6. **Failure Fixtures Added:** Existing package/tamper fixtures.
7. **Known Limitations:** This does not claim Developer ID signing, notarization or clean-machine approval.
8. **Security Boundaries:** Ad-hoc signing remains explicit; inherited API-key variables are removed.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** State regression remains.

## M14 — User-state Upgrade Regression

1. **Implementation Summary:** Added state exclusion, Base snapshot separation, stable app data identity and previous-profile retention.
2. **Files Changed:** App runtime and share modules.
3. **Architecture Decisions:** User State is never part of a Stack/Profile Definition artifact.
4. **Tests Added:** Session/cache/credential exclusion and active backup tests.
5. **Test Results:** Secret/state isolation and profile backup PASS; real credential/session preservation across a public clean-machine update is not claimed.
6. **Failure Fixtures Added:** `phase2-share-secret-isolation`, `phase2-atomic-switch`.
7. **Known Limitations:** Session compatibility is not yet semantically migrated; incompatible sessions remain a Harness responsibility.
8. **Security Boundaries:** No API key values were read, emitted, or copied.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Upstream candidate inspection is ready.

## M15 — Upstream Watcher

1. **Implementation Summary:** Added explicit Harness checkout inspection returning version, commit, dirty state and observation time.
2. **Files Changed:** `packages/core/src/upstream.ts`, CLI.
3. **Architecture Decisions:** Watcher observes an explicit candidate; it never follows `master` or publishes Stable.
4. **Tests Added:** Candidate metadata path is exercised by the upgrade command.
5. **Test Results:** Current official checkout observed clean at `0.1.0-rc.5` / `47f9438`; no distinct newer release was available in this run.
6. **Failure Fixtures Added:** Floating-ref and unsupported candidate policies remain in existing fixtures.
7. **Known Limitations:** No hosted watcher or scheduled GitHub action in this phase.
8. **Security Boundaries:** Candidate code is executed only when the caller explicitly supplies the checkout.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Same-version candidate verification is available; distinct upgrade remains pending.

## M16 — Harness Upgrade Candidate Verification

1. **Implementation Summary:** Added disposable candidate Stack pinning and standard Runtime Verify against an explicit Harness checkout.
2. **Files Changed:** `packages/core/src/upstream.ts`, CLI.
3. **Architecture Decisions:** Original Base/Derived Stack is never edited; candidate Receipt is separate.
4. **Tests Added:** Upgrade candidate receipt path.
5. **Test Results:** Explicit same-checkout candidate verification PASS; it is not represented as a newer Harness compatibility PASS.
6. **Failure Fixtures Added:** Existing Harness version mismatch and boot failure fixtures.
7. **Known Limitations:** A distinct upstream version and plugin compatibility run require external upstream availability.
8. **Security Boundaries:** Candidate verification uses a disposable Stack and sanitized runtime environment.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** STOP AND REVIEW; do not begin Registry/Marketplace/Studio.

## M17 — User Data Contract

1. **Implementation Summary:** Locked stable Distribution Storage Identity, User State exclusion, Native/JS `storageId` parity, and legacy `DSH Stack` Application Support compatibility in PRD §141.
2. **Files Changed:** `PRD.md`, `IMPLEMENTATION_PLAN.md`, `docs/phase-2-lifecycle.md`, `packages/core/assets/ReferenceShell.swift`, `packages/core/assets/update-state.mjs`, `packages/core/src/package-client.ts`.
3. **Architecture Decisions:** App version, Base integrity, Harness version, and public brand cannot derive a new User State root; unsafe storage IDs fail closed.
4. **Tests Added:** Stable/fallback storage identity and path-escape rejection; Native Shell asset assertions.
5. **Test Results:** PASS in automated tests and real compiled App metadata inspection.
6. **Failure Fixtures Added:** `update-user-state-mutation`.
7. **Known Limitations:** Existing third-party Harness state locations still require an explicit compatibility audit before Stable.
8. **Security Boundaries:** User State fingerprints contain paths, types, sizes and hashes only; no secret values are persisted or printed.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready for durable transaction implementation.

## M18 — Update Transaction Journal

1. **Implementation Summary:** Added atomic JSON Journal writes, update lock, User State fingerprint, Profile/Base/lifecycle backup paths, conservative recovery, and interrupted-transaction cleanup.
2. **Files Changed:** `packages/core/assets/update-state.mjs`, `packages/core/assets/reference-client.mjs`, update-state tests and fixtures.
3. **Architecture Decisions:** Only Stack-owned lifecycle paths are mutable; User State is opaque. Non-committed Journals always roll back conservatively.
4. **Tests Added:** User State mutation blocking, Profile/Base/lifecycle recovery, committed cleanup, and storage identity tests.
5. **Test Results:** PASS at the milestone; the suite was 37/37 at the initial journal implementation and is 44/44 after the later App updater, manifest, architecture, Journal-anchor, runtime-lock, and candidate-proof regressions were added. Real official Runtime integration remained PASS after the change.
6. **Failure Fixtures Added:** `update-transaction-interrupted`, `update-user-state-mutation`.
7. **Known Limitations:** App bundle replacement is implemented as the separate M20 transaction with its own Journal and rollback boundary; signed public installation and independent clean-machine recovery remain pending.
8. **Security Boundaries:** Journal paths are constrained to the stable storage root; credentials are hashed only for comparison and never logged.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Profile-level recovery is ready; App-level staging remains required.

## M19 — Verify-before-install

1. **Implementation Summary:** Added Update Manifest validation and architecture-specific asset selection; Native Shell checks an HTTPS feed before offering a user-driven download and later App selection.
2. **Files Changed:** `packages/core/src/update-manifest.ts`, `packages/core/src/types.ts`, `packages/core/assets/ReferenceShell.swift`, CLI package metadata options, `docs/update-manifest.example.json`.
3. **Architecture Decisions:** RC cannot auto-install an ad-hoc/unsigned artifact. Manifest identity, HTTPS, architecture and SHA-256 shape are rejected before a download is offered.
4. **Tests Added:** Cross-distribution, HTTP, duplicate/missing architecture and valid asset selection tests.
5. **Test Results:** PASS for manifest validation and local staged-candidate preflight; actual signed public App download and release-asset installation are not claimed.
6. **Failure Fixtures Added:** Update Manifest tests cover the failure modes.
7. **Known Limitations:** Full DMG download, signature verification, staging and pre-install candidate verification remain incomplete.
8. **Security Boundaries:** Native update check never invokes a shell, never modifies Application Support, and only opens an HTTPS asset after manifest validation.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** The separate App updater/helper is now implemented; proceed only to signed-public and clean-machine validation, and do not call Stable-ready.

## M20 — App Rollback and Health Check

1. **Implementation Summary:** Added the packaged `app-updater.mjs` helper, candidate Receipt binding, runtime-quiesce guard, App Journal, staged bundle replacement, first-launch pending/commit state, and recovery of App/Profile/Base/lifecycle metadata.
2. **Files Changed:** `packages/core/assets/app-updater.mjs`, `reference-client.mjs`, `update-state.mjs`, package asset deployment, Native Shell metadata and tests.
3. **Architecture Decisions:** Candidate App preflight runs only against disposable managed state; the real App commits only after its first Web UI health signal. App rollback and Profile rollback remain separate.
4. **Tests Added:** App Journal recovery, first-launch pending/commit, stale-backup protection, and local old-App → new-App staged update.
5. **Test Results:** Local x86_64 ad-hoc App pair PASS in temporary state with real official Harness preflight and first-launch Web UI health; old App retained. Signed public auto-install remains pending.
6. **Failure Fixtures Added:** `update-transaction-interrupted`, App updater recovery tests.
7. **Known Limitations:** Native Shell currently requires the user to mount the downloaded DMG and select the `.app`; full signed DMG download/install and clean-machine rollback remain pending.
8. **Security Boundaries:** Preflight excludes User State and removes declared secret environment variables; App replacement never copies User State into the candidate bundle.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Ready for release-manifest integration and external signed/clean-machine validation.

## M21 — Update Manifest / Check UX

1. **Implementation Summary:** Added Native Shell `Check for Updates…`, `Install Update…`, versioned client metadata, architecture-aware manifest selection, and user-driven RC installation through the standard updater.
2. **Files Changed:** `ReferenceShell.swift`, `Info.plist`, `package-client.ts`, `packages/cli/src/main.ts`, README files.
3. **Architecture Decisions:** Update UX is Native Shell-owned and remains available independently of Harness Web UI health. No second Profile or Plugin manifest was introduced.
4. **Tests Added:** CLI option parsing, compiled App metadata, manifest validation and Native Shell source assertions.
5. **Test Results:** PASS for compiled x86_64 App, manual-check/install code path, local staged App updater, candidate Receipt binding, runtime-quiesce guard, and manifest validation; no live public Update Manifest is published by this change.
6. **Failure Fixtures Added:** `docs/update-manifest.example.json` is an explicit template, not release evidence.
7. **Known Limitations:** Automatic signed installation remains pending M20 and Apple credentials.
8. **Security Boundaries:** HTTPS-only feed, Distribution ID match, channel match, architecture match and SHA-256 shape validation; no silent install.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** M22 must cover real User State preservation and external update behavior.

## M22 — User-state Upgrade E2E

1. **Implementation Summary:** Completed representative local App upgrade evidence; the full public/clean-machine User State contract remains incomplete.
2. **Files Changed:** Transaction assets, stable Distribution metadata, updater helper, fixtures and lifecycle records.
3. **Architecture Decisions:** Real state migration is copy-on-write; unknown or incompatible Harness state blocks rather than being guessed.
4. **Tests Added:** Representative state fingerprint and interrupted recovery tests.
5. **Test Results:** Representative credential/session/preferences files remained unchanged through a local x86_64 staged update and first-launch Health Check; real user-owned credentials/session/history/workspace upgrade on an independent machine remains `INCOMPLETE`.
6. **Failure Fixtures Added:** `update-user-state-mutation`, `update-transaction-interrupted`.
7. **Known Limitations:** Requires a real packaged old/new App pair, upgrade interruption injection, and clean user-state evidence.
8. **Security Boundaries:** Test evidence records hashes and counts, never real credentials.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** STOP before Stable; run signed DMG, clean-machine and real user-state upgrade validation.

## STOP AND REVIEW

1. **Implementation Summary:** Profile lifecycle and the first User Data Preservation transaction layer are implemented; product-level App update safety remains incomplete.
2. **Files Changed:** This record and the User Data Preservation implementation/docs.
3. **Architecture Decisions:** Keep `.dshstack` as default sharing; keep standalone App advanced; no ecosystem accumulation.
4. **Tests Added:** 44 automated tests plus real official Freeze/Verify/Pack/Import/Package/App metadata/integration paths.
5. **Test Results:** Core lifecycle and transaction fixtures PASS; local installed-App rollback and representative User State preservation PASS; real user-owned upgrade, external clean-machine lifecycle, and signed release remain incomplete.
6. **Failure Fixtures Added:** Lifecycle fixtures plus `update-user-state-mutation` and `update-transaction-interrupted`.
7. **Known Limitations:** No distinct Harness upgrade, no external clean-machine lifecycle UAT, and no Developer ID/notarization proof. The local App updater/helper transaction is implemented and tested, but is not yet enabled as a trusted public auto-installer.
8. **Security Boundaries:** Zero False PASS remains in force.
9. **PRD Deviations:** None.
10. **Readiness for Next Milestone:** Review and decide GO/NO-GO for Phase 3 Verification CI; do not auto-enter Registry/Marketplace/Studio.
