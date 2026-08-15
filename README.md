# DSH Stack

DSH Stack is a reproducibility and distribution layer for an existing DeepSeek Harness Profile.

The project deliberately delegates composition, plugin loading, dependency resolution, runtime boot, Agent Loop, and the Web UI to the official Harness. Its first proof path is:

```text
inspect → preflight → freeze → verify → run --clean
```

## Current status

Milestone 0 is under implementation. The authoritative product requirements are in [`PRD.md`](PRD.md), and the executable mapping is in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

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

This produces an ad-hoc signed `.app` containing an embedded Node runtime, the deployed official Harness closure, the frozen Profile, and a generic AppKit/WebKit Native Shell that hosts the official Web UI in its own window. It does not hand the URL to Safari or another default browser. Apple Developer signing/notarization and a non-developer real-Agent UAT are still release gates; see [`docs/reference-distribution-uat.md`](docs/reference-distribution-uat.md).

Runtime verification executes Harness and plugin code from the Stack. The disposable home is for reproducibility isolation, not a security sandbox or malware boundary.
