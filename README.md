# DSH Stack

DSH Stack is a reproducibility and distribution layer for an existing DeepSeek Harness Profile.

The project deliberately delegates composition, plugin loading, dependency resolution, runtime boot, Agent Loop, and the Web UI to the official Harness. Its first proof path is:

```text
inspect → preflight → freeze → verify → run --clean
```

## Current status

Milestone 0 is under implementation. The authoritative product requirements are in [`PRD.md`](PRD.md), and the executable mapping is in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## Validation status

### Single-machine E2E — PASS

The developer-run single-machine E2E checkpoint completed on **2026-08-15**. It covers the standard Stack path and the packaged Native Shell integration on one Mac:

```text
official Profile → Freeze → Verify / Prove → Reproduce → Package → Native Shell → official Harness Web UI
```

Evidence and environment:

- `examples/reference/verification.receipt.json` is a Runtime `PASS` with `cacheUsed: false`, official Web UI readiness, and localhost-only health evidence.
- `DSH Stack Reference v10.app` launched as an ad-hoc signed x86_64 Mach-O app with a restricted runtime `PATH`; it used the embedded Node/runtime closure and opened the official Harness UI inside the app window without handing off to Safari or Chrome.
- The official Models form was editable after startup, and the Native Shell accepted `⌘V` / `Edit → Paste` into the official API-key field. The paste regression used a synthetic clipboard value and did not send a live LLM request.
- Environment: macOS 26.5.2 (build 25F84), 6-core Intel Core i7, 16 GB RAM, x86_64; Node v26.5.0; pnpm 11.12.0; DeepSeek Harness `0.1.0-rc.5` at commit `47f943859bef60e4160492346772ded9b24f765a`.
- Repository checks: `pnpm typecheck` passed; `pnpm test` passed with 15/15 tests.

This PASS is limited to the single-machine pipeline/package/UI integration checkpoint. The following release gates remain **PENDING**:

- Non-developer clean-machine UAT: Download → Install → Open → configure a real API key → complete a real Agent Session without Terminal or developer intervention.
- Apple Developer signing and notarization.

The current reference Harness checkout is discovered through `--harness` or `DSH_HARNESS_ROOT`. The repository does not assume a globally installed `dsh` command.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm dsh-stack --help
```

Inspect the current official Web Profile without modifying it:

```sh
pnpm dsh-stack inspect --profile web --harness ../deepseek-harness
```

Freeze it into an artifact:

```sh
pnpm dsh-stack freeze --profile web --harness ../deepseek-harness --output examples/reference
```

Verify a frozen artifact in a disposable DSH home:

```sh
pnpm dsh-stack verify examples/reference --harness ../deepseek-harness
```

Run the same materialized artifact through the official Harness Web UI:

```sh
pnpm dsh-stack run examples/reference --clean --harness ../deepseek-harness
```

Build the generic macOS Reference Client after the Stack has a Runtime PASS receipt:

```sh
pnpm dsh-stack package examples/reference --harness ../deepseek-harness
```

This produces an ad-hoc signed `.app` containing an embedded Node runtime, the deployed official Harness closure, the frozen Profile, and a generic AppKit/WebKit Native Shell that hosts the official Web UI in its own window. It does not hand the URL to Safari or another default browser, and it does not inject API keys into the Harness environment: the official credentials provider owns the editable credential store. Apple Developer signing/notarization and a non-developer real-Agent UAT are still release gates; see [`docs/reference-distribution-uat.md`](docs/reference-distribution-uat.md).

Runtime verification executes Harness and plugin code from the Stack. The disposable home is for reproducibility isolation, not a security sandbox or malware boundary.
