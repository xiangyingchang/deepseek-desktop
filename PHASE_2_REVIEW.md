# Phase 2 Review — Real-world Profile Generalization

Recorded **2026-08-16 Asia/Shanghai**. The compatibility matrix is the source of stage-level truth: [`docs/phase-2-compatibility-matrix.json`](docs/phase-2-compatibility-matrix.json).

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
- artifact-hash storage isolation prevents two `web` variants from sharing stale user Profile data;
- `dsh-stack package --size-report` emits a machine-readable closure breakdown;
- real failures are preserved as regression fixtures.

## Profile-specific hardcode audit

No Profile name or external repository name was added to core business logic. The only case names are in research documents, matrix evidence, and fixtures. All compatible cases use the same `SourceHarnessAdapter`, `StackMaterializer`, integrity, verification, and package path.

## Package size

Vanilla x64 baseline: **395,230,165 bytes** for App Contents. Observed external packages were:

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

## Final decision

```text
Phase 2: NO-GO
Phase 3 Verification CI: NO-GO
```

Reason: the generalized technical pipeline is working and has genuine PASS/FAIL/UNSUPPORTED evidence, but the Phase 2 user acceptance gate for an external Profile has not been completed. Do not enter Registry / Marketplace / Studio. The next valid action is an independent clean-machine Live Agent UAT for one packaged external Web Profile, followed by a review of the same receipts and matrix.
