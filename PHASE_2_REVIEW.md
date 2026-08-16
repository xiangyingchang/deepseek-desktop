# Phase 2 Review — Real-world Profile Generalization

Recorded **2026-08-17 Asia/Shanghai**. The compatibility matrix is the source of stage-level truth: [`docs/phase-2-compatibility-matrix.json`](docs/phase-2-compatibility-matrix.json).

This file now contains two evidence layers: the earlier external Profile generalization review below, and the current lifecycle review in this section. The lifecycle review does not overwrite the earlier matrix or convert fixture evidence into Live Agent evidence.

## Lifecycle model review — Base / Derived / Rebase / Share

### Implemented generic capabilities

- `distribution.yaml` carries release metadata only; it does not duplicate `dsh.profile.bundles`.
- `DistributionManifest` distinguishes `derived`, `candidate`, and `base` lifecycle identity; Receipts record the lifecycle kind when present.
- `dsh-stack drift` reports Profile-owned changes without mutating the working Profile.
- `dsh-stack rebase` and `update` implement `A = old Base`, `B = current Derived`, `C = new Base`, with structured additive merge and explicit `UPDATE_REBASE_CONFLICT`.
- Verify-before-switch and atomic directory switching retain `<active>.previous` when a candidate is accepted.
- `dsh-stack promote` is manual and invalidates the old Receipt until the Candidate is verified.
- `dsh-stack pack` / `import` make `.dshstack` the default state-free sharing path; Pack runs the real Verify gate, and both directions enforce Integrity, regular-file, and secret/user-state boundaries.
- Packaged App data uses stable distribution identity and embeds the generic runtime Rebase path; it no longer keys user data by Base artifact hash.
- Explicit `upgrade-verify` inspects a supplied Harness checkout and verifies a disposable candidate Stack through the normal materializer.
- Published Reference metadata preserves the legacy public v10 storage identity `dsh-web-5590c2a0cb00b3a7`; a new package no longer silently falls back to a fresh `dsh-web` data root.
- App updater assets now support disposable managed-state preflight, candidate Receipt binding, runtime-quiesce blocking, durable App Journal, staged App replacement, first-launch commit, and old-App recovery; RC UX remains user-driven download/install and does not claim signed automatic installation.

### Lifecycle E2E evidence actually completed

| Case | Result | Boundary |
|---|---|---|
| Official Web Base Freeze → Runtime Verify | PASS | `0.1.0-rc.5`, commit `47f9438`, receipt hash `sha256-f6ceba54…f0902c` |
| Maintainer Promote → Candidate Verify | PASS | Same official Profile, candidate metadata and new receipt |
| `.dshstack` Pack → Import → Runtime Verify | PASS | Exact Integrity retained; state-free allowlist passed |
| User/Base independent changes → Rebase → Runtime Verify → Atomic Switch | PASS | Real official Harness in isolated temp paths; both changes survived |
| Same key changed by User/Base → conflict | PASS (blocked as designed) | `UPDATE_REBASE_CONFLICT`; old Profile unchanged |
| Packaged App runtime Base update | PASS | Isolated HOME; official UI verified before switch; user marker and Base marker both present |
| Packaged App runtime conflict | PASS (blocked as designed) | Process stopped before runtime; active Profile and previous backup preserved |
| Local old App → new App staged update | PASS | x86_64 temp App pair; real official Harness preflight; old App retained; App Journal committed after first-launch Web UI health |
| User State preservation during App update | PASS (representative fixture) | Credentials/session/preferences fixture contents unchanged; no real user credential values used |
| Interrupted App transaction recovery | PASS | App/Profile/Base/lifecycle recovery fixtures restored the old environment |
| Automated lifecycle regression suite | PASS | 44/44 tests |

### Lifecycle items not promoted to PASS

- A real third-party Bundle installation through the official Harness command was attempted with `mario03690/dsh-netcafe` at `6873f2d`. The upstream source command hit a non-interactive production install/postinstall failure around `lefthook`; the local Harness dependency tree was restored with `pnpm install --frozen-lockfile`. This is recorded as an upstream Harness/source-install blocker, not a DSH Stack compatibility PASS.
- The Bundle-addition merge is proven by generic regression fixtures, but the required external third-party Bundle Promotion and Live Agent path is `INCOMPLETE`.
- `upgrade-verify` passed against the current same-version official checkout as an explicit candidate smoke; no distinct newer Harness version was available in this run.
- No independent clean-machine test of an external Derived `.dshstack` has been completed.
- No public signed DMG has been downloaded and automatically installed by the updater; the local App updater E2E used an ad-hoc x86_64 App pair and temporary state only.
- Real user-owned Harness session/history/workspace migration across a public release is not claimed; the current PASS is representative fixture plus isolated local E2E evidence.
- Developer ID signing, Hardened Runtime, notarization, and stapling remain external Apple credential gates.

### Lifecycle receipt sufficiency

Receipts now distinguish Base/Candidate/Derived lifecycle kind and still bind exact Stack Integrity. They do not attempt to encode the entire User Delta or conflict resolution history; the Rebase report is separate evidence. A Base Receipt still does not prove a modified Derived Profile, and a `.dshstack` import still requires a new Verify.

### Lifecycle package boundary

The latest fixed x86_64 lifecycle App package measured **397,031,960 bytes** in the machine-readable App Contents size report and contained only the exact official runtime plus the current Profile closure. The transaction assets and Native Install Update path account for the increase from the earlier baseline. The tested App contained no other Profile or global Plugin repository. This is a local lifecycle package measurement, not a replacement public Release asset.

## Cases tested

Nine external repositories were researched and ten concrete Profile cases were exercised:

- `w2112515/dsh-plugin-development` — plain JS/Markdown Web bundle.
- `PerryLink/dsh-plugin-guide` — large documentation/Skill Web bundle.
- `xiaoxianyu-office/dsh-router-flash` — prebuilt host/client and preset bundle.
- `mario03690/dsh-netcafe` — configuration-only MCP bundle, tested in the official Web Profile and in a base-only custom Profile.
- `skillre/dsh-bundle-vision` — prebuilt runtime-code bundle with a model-facing tool.
- `dongsheng123132/dsh-profile-lock-proof` — Git bundle with a nested npm dependency and a real activation failure.
- `hyls9527/dsh-bundle-updater` — Git bundle with a missing build artifact.
- `gejiliang/dshr` — workspace/link bundle and rc.6 dependency train.
- `TheMcSwift/DeepSeek-TUI` — local-link TUI bundle with many Harness workspace links.

All external sources were pinned to full commit SHAs. Third-party repositories were not modified.

## PASS / FAIL / UNSUPPORTED / INCOMPLETE distribution

At the stage level, five external Web bundle cases reached `Freeze PASS`, `Runtime Verify PASS`, and `Package PASS`: plugin-development, plugin-guide, router-flash, netcafe(Web), and bundle-vision. Two cases failed before or during the standard pipeline: lock-proof activation and bundle-updater missing build output. Two cases are explicitly unsupported because of local/workspace links: dshr and DeepSeek-TUI. The custom base-only netcafe Profile is unsupported by the current Web Client surface because it does not mount `dsh-web-app`.

The five technically compatible cases remain `INCOMPLETE` overall because no external clean-machine Live Agent UAT was performed. Their App launch checks were not converted into Live Agent PASS.

## New real-world failure types

1. A configuration-only bundle can have no `main`; static resolution must inspect its package directory and `dsh.bundle` metadata.
2. A Profile may pass package installation while a third-party Cordis plugin fails at activation due to a missing injection declaration.
3. A Git package can declare a runtime entry while omitting the built entry and any reproducible prepare step.
4. `link:` / workspace dependencies can look installed on the developer machine but are not portable Profile inputs.
5. A custom Profile can be portable yet intentionally lack the Web surface; silently falling back to the default Web Profile would be a false PASS.

## Generic DSH Stack capabilities added

- exact Profile name is used by Verify, `run --clean`, and the packaged client;
- no-main/configuration-only bundles resolve from their package directory;
- lockfile specifiers are compared with `package.json`;
- duplicate Harness/runtime dependencies, platform-targeted direct dependencies, dangling Cordis references, missing bundle entries, lifecycle scripts, and secret/user-data boundaries are preflighted;
- Package uses the same materialization path to embed the exact Profile dependency closure;
- stable Distribution Storage Identity plus legacy storage compatibility prevents Base/App artifact changes from creating an empty user environment;
- disposable App preflight, durable App Journal, first-launch commit, and App/Profile recovery prevent a failed candidate from stranding the old environment;
- `dsh-stack package --size-report` emits a machine-readable closure breakdown;
- real failures are preserved as regression fixtures.

## Profile-specific hardcode audit

No Profile name or external repository name was added to core business logic. The only case names are in research documents, matrix evidence, and fixtures. All compatible cases use the same `SourceHarnessAdapter`, `StackMaterializer`, integrity, verification, and package path.

## Package size

Vanilla x64 pre-fix baseline: **396,945,966 bytes**. The fixed lifecycle App is **397,031,960 bytes**; the external Profile observations below are historical comparison artifacts from the earlier Phase 2 package run:

- plugin-development: 395,297,393 bytes;
- plugin-guide: 399,472,879 bytes;
- netcafe: 395,248,122 bytes;
- bundle-vision: 395,259,146 bytes.

The external bundle appears under each App's `Resources/profile/node_modules`; it is absent from the Harness runtime closure. No observed increase exceeded the 10% warning threshold. The aggregate machine-readable evidence is [`docs/package-size-report.json`](docs/package-size-report.json).

## Verification Receipt sufficiency

The current Runtime Receipt is sufficient to prove one exact Stack was statically verified and booted in a clean materialization, including Harness version, commit, Profile, platform, stages, integrity, and localhost UI health. It is not sufficient by itself to express cross-Profile compatibility, external MCP reachability, real Agent success, clean-machine UAT, or package-size regression. Those remain separate matrix/UAT evidence and must not be inferred from `verification.result: pass`.

## Product judgment

Largest product value: DSH Stack can now take several real, non-official Web Profile bundles—including a configuration-only MCP bundle and a large documentation bundle—and turn them into reproducible, self-contained App artifacts through one generic pipeline.

Largest technical risk: the official Harness is still a developer-preview contract. Community bundles claim different Harness trains, may execute lifecycle/build code, may depend on external services, and can fail only during Cordis activation or real Agent use after static checks pass.

## External UAT status

Developer-machine App launch passed for packaged `netcafe` and `plugin-guide` artifacts, using temporary HOME directories and no API key. No non-official Profile has yet completed independent clean-machine UAT with tester-entered API key and a real Agent turn. This is **External UAT Blocked**, not PASS.

## User Data Preservation review

The current implementation now distinguishes three states:

```text
App Update staged
→ Candidate preflight PASS in disposable managed state
→ App switched, Journal pending
→ First launch Web UI health PASS
→ Journal committed
```

The App updater does not run the candidate against the real User State during preflight. It refuses to start while a live Runtime lock exists, and the Native Shell stops the current Runtime before invoking the updater. The real App only commits the pending Journal after its first successful Web UI health signal. If the next launch fails before that signal, the Journal restores the previous App and managed Profile state. Profile `.previous` and App rollback are separate recovery boundaries.

This is strong local transaction evidence, not yet a Stable Release claim. Developer ID signing, notarization, public DMG download verification, clean-machine upgrade, and real user-owned Harness state migration remain pending.

The latest rerun also completed the official integration path with receipt `sha256-d5b6ca1fc7a5a770d868628eb92599ab417d2ec58f7c36acdc3d12b23cc623da`. The local x86_64 App transaction used the same stable storage id, preserved the representative User State fixture, retained the previous App rollback copy, and committed only after `DSH_STACK_READY`.

## Final decision

```text
Phase 2: NO-GO
Phase 3 Verification CI: NO-GO
```

Reason: the lifecycle core and local update transaction are working with genuine PASS/FAIL/CONFLICT evidence, but the Phase 2 acceptance gate still requires a real external Bundle Promotion/Live Agent path, independent clean-machine UAT, and signed/notarized release validation. The upstream source-install blocker, absence of a distinct newer Harness candidate, and Apple release credentials remain explicit blockers. Do not enter Registry / Marketplace / Studio. The next valid action is to complete signed Release/App updater validation and run one external `.dshstack` clean-machine Live Agent UAT.
