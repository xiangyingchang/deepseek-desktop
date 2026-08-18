# Release Update Feed Runbook

How to publish a macOS Reference Client release so installed Apps can detect
and install it through **DeepSeek Desktop -> Check for Updates…** and
**Install Update…**.

## How the feed works

- Every packaged App embeds one HTTPS Update Manifest URL in
  `Contents/Resources/client.json` (`--update-manifest-url` at Package time).
  Builds without it intentionally fall back to the manual Install Update flow.
- The embedded URL is the **evergreen GitHub address**
  `https://github.com/<owner>/<repo>/releases/latest/download/update-manifest.json`.
  It always resolves to the newest **non-prerelease** Release.
- Asset URLs inside the manifest point at the immutable tag download URL
  `…/releases/download/<tag>/<file>`, which is deterministic: the feed URL can
  be baked into the App before the Release exists (chicken-and-egg solved).
- `Check for Updates…` only detects the new version and opens the DMG
  download; the user then applies it via **Install Update…**, which verifies
  the candidate App's embedded Verification Receipt and Stack Integrity before
  the transactional swap.

## Per release

1. **Build with the feed URL and tag** (one command; the manifest is generated
   automatically at the end when both variables are set):

   ```bash
   DSH_STACK_APP_VERSION=0.2.0-rc.12 \
   DSH_STACK_RELEASE_TAG=v0.2.0-rc.12 \
   DSH_STACK_STORAGE_ID=dsh-web-5590c2a0cb00b3a7 \
   DSH_STACK_UPDATE_MANIFEST_URL="https://github.com/<owner>/<repo>/releases/latest/download/update-manifest.json" \
   DSH_STACK_UPDATE_CHANNEL=rc \
   DSH_STACK_OUTPUT_DIR="$PWD/dist/release/v0.2.0-rc.12" \
   bash scripts/build-macos-reference.sh
   ```

   `DSH_STACK_STORAGE_ID` **must stay `dsh-web-5590c2a0cb00b3a7` for the whole
   distribution line**: it selects the User State directory
   (`~/Library/Application Support/DSH Stack/<storageId>` - API keys,
   sessions, settings). Building without it freezes a bare distribution whose
   App falls back to `dsh-web` and appears to lose existing user state after
   an update.

   Output: the `.app`, `.dmg`, `.dmg.sha256`, `-verification.receipt.json`,
   and `update-manifest.json` in the output directory.

   Without the build pipeline you can regenerate the manifest from an existing
   release directory:

   ```bash
   node scripts/generate-update-manifest.mjs \
     --dist dist/release/v0.2.0-rc.12 \
     --tag v0.2.0-rc.12
   ```

2. **Publish on GitHub** (prefer the repository workflow):
   - Push an explicit version tag such as `v0.2.0-rc.12`; the macOS workflow runs native x64 and arm64 packaging through the same pipeline.
   - The publish job merges the architecture manifests and uploads one `update-manifest.json` plus the matching DMGs, SHA-256 files, receipts, and package-size reports.
   - If the Intel hosted runner is queued, use `Publish Reference Release from Verified Artifact` with the completed arm64 run ID and the draft Release tag. It downloads the verified artifact inside GitHub Actions, merges the manifests, and only then publishes.
   - Upload `DeepSeek-Desktop-Unofficial-macos-<arch>.dmg`, its `.sha256`, the
     `-verification.receipt.json`, package-size report, and `update-manifest.json` **with those
     exact file names**.
   - Do **not** check "pre-release": `releases/latest/download/…` stops
     resolving to prereleases and every installed App's update check would
     404.
   - Publish. Verify:
     `curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/update-manifest.json`.

3. **Existing Apps** pick it up on **Check for Updates…** (version must
   compare greater, e.g. `0.2.0-rc.12` > `0.2.0-rc.11`), download the DMG,
   and install through **Install Update…**.

## Constraints enforced by the App and the manifest validator

- `distributionId` must match the installed App (`dsh-web` for this line).
- `channel` must match the App's `updateChannel` (`rc` unless overridden).
- Exactly one asset per architecture, HTTPS-only URLs, 64-hex SHA-256.
- `minimumMacOS` must not exceed the checking Mac's version.
- RC builds never auto-install; the download is user-driven by design.

## Notes

- Multi-architecture feeds: build each architecture independently, then merge
  the single-architecture manifests with
  `scripts/merge-update-manifest.mjs`. Native closures can have different
  `baseIntegrity` hashes; the manifest keeps the legacy global field for old
  Apps and binds the exact hash on each `assets[].baseIntegrity` entry.
- Ad-hoc signed builds (no `DSH_STACK_CODESIGN_IDENTITY`) are fine for
  personal distribution; Gatekeeper quarantine applies to downloaded DMGs
  as usual.
