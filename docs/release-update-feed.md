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
   DSH_STACK_APP_VERSION=0.2.0-rc.11 \
   DSH_STACK_RELEASE_TAG=v0.2.0-rc.11 \
   DSH_STACK_STORAGE_ID=dsh-web-5590c2a0cb00b3a7 \
   DSH_STACK_UPDATE_MANIFEST_URL="https://github.com/<owner>/<repo>/releases/latest/download/update-manifest.json" \
   DSH_STACK_UPDATE_CHANNEL=rc \
   DSH_STACK_OUTPUT_DIR="$PWD/dist/release/v0.2.0-rc.11" \
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
     --dist dist/release/v0.2.0-rc.11 \
     --tag v0.2.0-rc.11
   ```

2. **Publish on GitHub** (web UI, ~2 minutes):
   - Create a Release with tag `v0.2.0-rc.11`.
   - Upload `DeepSeek-Desktop-Unofficial-macos-<arch>.dmg`, its `.sha256`, the
     `-verification.receipt.json`, and `update-manifest.json` **with those
     exact file names**.
   - Do **not** check "pre-release": `releases/latest/download/…` stops
     resolving to prereleases and every installed App's update check would
     404.
   - Publish. Verify:
     `curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/update-manifest.json`.

3. **Existing Apps** pick it up on **Check for Updates…** (version must
   compare greater, e.g. `0.2.0-rc.11` > `0.2.0-rc.10`), download the DMG,
   and install through **Install Update…**.

## Constraints enforced by the App and the manifest validator

- `distributionId` must match the installed App (`dsh-web` for this line).
- `channel` must match the App's `updateChannel` (`rc` unless overridden).
- Exactly one asset per architecture, HTTPS-only URLs, 64-hex SHA-256.
- `minimumMacOS` must not exceed the checking Mac's version.
- RC builds never auto-install; the download is user-driven by design.

## Notes

- Multi-architecture feeds: build each arch into the same output directory
  (or merge), then run the generator once; it publishes one asset per `.app`
  found. Currently one arch per directory is expected.
- Ad-hoc signed builds (no `DSH_STACK_CODESIGN_IDENTITY`) are fine for
  personal distribution; Gatekeeper quarantine applies to downloaded DMGs
  as usual.
