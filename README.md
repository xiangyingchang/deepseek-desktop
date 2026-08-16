# DeepSeek Desktop (Unofficial)

[中文版](README.zh-CN.md) | English

> An unofficial community desktop client for the official DeepSeek Harness. It is not an official DeepSeek product.

DeepSeek Desktop packages an existing DeepSeek Harness Profile as a self-contained macOS app. The technical project and CLI are called **DSH Stack** / `dsh-stack`.

DSH Stack does not reimplement the Harness runtime, plugin system, pnpm, dependency resolution, Agent Loop, or official Web UI. It freezes, verifies, reproduces, and packages the official Harness environment.

## Download

Open the [current public Reference / RC Release](https://github.com/xiangyingchang/dsh-stack/releases/tag/v0.1.0-reference-v10) and download the DMG that matches your Mac:

| Mac | Download | CPU | Current evidence |
|---|---|---|---|
| Intel Mac | [DSH-Stack-Reference-macos-x64.dmg](https://github.com/xiangyingchang/dsh-stack/releases/download/v0.1.0-reference-v10/DSH-Stack-Reference-macos-x64.dmg) | x86_64 | Packaging, Live Agent, and clean-machine UAT: PASS |
| Apple Silicon Mac | [DSH-Stack-Reference-macos-arm64.dmg](https://github.com/xiangyingchang/dsh-stack/releases/download/v0.1.0-reference-v10/DSH-Stack-Reference-macos-arm64.dmg) | arm64 | Native packaging: PASS; manual App and Live Agent UAT: pending |

The Release also contains matching SHA-256 files and verification receipts. The current public assets still use the historical `DSH-Stack-Reference-*` name; the source tree now builds the branded `DeepSeek Desktop (Unofficial)` app, but that rebuild has not yet replaced the public Release assets.

This is a **Reference / RC pre-release**, not Stable. Current public apps are ad-hoc signed and not notarized, so macOS may show an approval warning on first launch.

## Install and use

You do not need Node, pnpm, the `dsh-stack` CLI, a pre-installed Profile, or a Terminal.

1. Download the DMG for your Mac.
2. Open the DMG and drag the app to `Applications`.
3. Double-click the app. If macOS shows a security warning, Control-click the app, choose **Open**, and confirm.
4. Open the official Harness **Models** settings page.
5. Edit the **DeepSeek** provider, enter your API key, and save it. `⌘V` / **Edit → Paste** is supported.
6. Create a Web session and send a message.
7. If the key is rejected, return to the same Models page, replace it, save, and retry. Restarting is not required.

The API key is stored by the official Harness credentials provider. DSH Stack does not print or embed the key in the app.

## Which file should I download?

On your Mac, open **Apple menu → About This Mac**:

- If it says **Processor: Intel**, download the x64 DMG.
- If it says **Chip: Apple M1/M2/M3/M4...**, download the arm64 DMG.

Do not download the source ZIP unless you are a developer. It is not the normal installation path.

## Current status

| Area | Status |
|---|---|
| x86_64 Freeze → Verify → Package → DMG | PASS |
| x86_64 App launch and official Harness UI | PASS |
| x86_64 real Agent session and restart | PASS |
| x86_64 clean-machine UAT | PASS for the current Reference artifact |
| arm64 native Freeze → Verify → Package → DMG | PASS in CI |
| arm64 App launch, Live Agent, and clean-machine UAT | Pending Apple Silicon validation |
| Developer ID signing, Hardened Runtime, notarization, stapling | Pending external Apple credentials |
| Stable `v0.1.0` | Not released |

## For developers

Install dependencies and run the automated checks:

```sh
pnpm install
pnpm typecheck
pnpm test
```

The standard pipeline is:

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

Inspect a Profile without changing it:

```sh
pnpm dsh-stack inspect --profile web --harness ../deepseek-harness
```

Freeze and verify a Profile:

```sh
pnpm dsh-stack freeze --profile web --harness ../deepseek-harness --output examples/reference
pnpm dsh-stack verify examples/reference --harness ../deepseek-harness
```

Run the verified artifact through the official Web UI:

```sh
pnpm dsh-stack run examples/reference --clean --harness ../deepseek-harness
```

Package a Runtime-PASS Stack as a macOS app:

```sh
pnpm dsh-stack package examples/reference --harness ../deepseek-harness --size-report
```

The package contains the exact Harness and Profile closure required by that Stack. It does not contain other Profiles, plugins, or a shared runtime repository.

## Documentation

- [PRD](PRD.md) — product contract and acceptance criteria
- [Implementation plan](IMPLEMENTATION_PLAN.md) — milestone history and engineering decisions
- [Reference distribution UAT](docs/reference-distribution-uat.md) — manual installation and user test
- [Phase 2 generalization](docs/phase-2-generalization.md) — external Profile compatibility work
- [Phase 2 review](PHASE_2_REVIEW.md) — PASS / FAIL / UNSUPPORTED conclusions

## Security boundary

Verification and packaging execute Harness and plugin code. The disposable runtime home provides reproducibility isolation, not a security sandbox or malware boundary. API keys remain under the official Harness credential provider.
