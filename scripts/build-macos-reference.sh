#!/usr/bin/env bash
set -euo pipefail

# Build one architecture through the product pipeline:
# Freeze -> Verify / Prove -> Reproduce -> Package -> DMG.
# The script never turns a missing signing or notarization credential into a
# PASS; it leaves the artifact ad-hoc and prints the missing release gate.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${DSH_STACK_PROFILE:-web}"
HARNESS_ROOT="${DSH_HARNESS_ROOT:-$ROOT_DIR/../deepseek-harness}"
ARCH="${DSH_STACK_ARCH:-$(node -p 'process.arch')}"
OUTPUT_DIR="${DSH_STACK_OUTPUT_DIR:-$ROOT_DIR/dist/release/$ARCH}"
SIGNING_IDENTITY="${DSH_STACK_CODESIGN_IDENTITY:-}"
NODE_RUNTIME="${DSH_STACK_NODE_RUNTIME:-}"
NOTARY_PROFILE="${DSH_STACK_NOTARY_PROFILE:-}"
APP_VERSION="${DSH_STACK_APP_VERSION:-}"
STORAGE_ID="${DSH_STACK_STORAGE_ID:-}"

phase() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1"
}

case "$ARCH" in
  x64) ARCH_LABEL="Intel-x86_64"; ARCH_DISPLAY_LABEL="Intel" ;;
  arm64) ARCH_LABEL="Apple-Silicon-arm64"; ARCH_DISPLAY_LABEL="Apple Silicon" ;;
  *) echo "Unsupported DSH_STACK_ARCH: $ARCH (expected x64 or arm64)" >&2; exit 2 ;;
esac

if [[ ! -d "$HARNESS_ROOT" ]]; then
  echo "DeepSeek Harness checkout not found: $HARNESS_ROOT" >&2
  exit 2
fi

HOST_ARCH="$(node -p 'process.arch')"
if [[ "$HOST_ARCH" != "$ARCH" && -z "$NODE_RUNTIME" ]]; then
  echo "Cross-architecture build requires DSH_STACK_NODE_RUNTIME for $ARCH; native host is $HOST_ARCH." >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dsh-stack-release.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
STACK_DIR="$WORK_DIR/stack"
APP_PATH="$OUTPUT_DIR/DeepSeek Desktop (Unofficial).app"
ARTIFACT_BASENAME="DeepSeek-Desktop-Unofficial-macos-$ARCH_LABEL"
DMG_PATH="$OUTPUT_DIR/$ARTIFACT_BASENAME.dmg"
RECEIPT_PATH="$OUTPUT_DIR/$ARTIFACT_BASENAME-verification.receipt.json"
SIZE_REPORT_PATH="$OUTPUT_DIR/DeepSeek Desktop (Unofficial)-package-size-report.json"
PUBLIC_SIZE_REPORT_PATH="$OUTPUT_DIR/$ARTIFACT_BASENAME-package-size-report.json"

if [[ -e "$APP_PATH" || -e "$DMG_PATH" ]]; then
  echo "Refusing to overwrite existing release output in $OUTPUT_DIR" >&2
  exit 3
fi

cd "$ROOT_DIR"

FREEZE_ARGS=(pnpm dsh-stack freeze --profile "$PROFILE" --harness "$HARNESS_ROOT" --output "$STACK_DIR")
if [[ -n "$STORAGE_ID" ]]; then FREEZE_ARGS+=(--storage-id "$STORAGE_ID"); fi
phase "Freeze started"
"${FREEZE_ARGS[@]}"
phase "Freeze completed"

VERIFY_ARGS=(pnpm dsh-stack verify "$STACK_DIR" --harness "$HARNESS_ROOT")
phase "Verify started"
"${VERIFY_ARGS[@]}"
phase "Verify completed"

PACKAGE_ARGS=(pnpm dsh-stack package "$STACK_DIR" --harness "$HARNESS_ROOT" --arch "$ARCH" --output "$APP_PATH" --size-report)
if [[ -n "$NODE_RUNTIME" ]]; then PACKAGE_ARGS+=(--node-runtime "$NODE_RUNTIME"); fi
if [[ -n "$APP_VERSION" ]]; then PACKAGE_ARGS+=(--app-version "$APP_VERSION"); fi
if [[ -n "$SIGNING_IDENTITY" ]]; then PACKAGE_ARGS+=(--signing-identity "$SIGNING_IDENTITY" --hardened-runtime); fi
phase "Package started"
"${PACKAGE_ARGS[@]}"
phase "Package completed"

if [[ -f "$SIZE_REPORT_PATH" ]]; then
  mv "$SIZE_REPORT_PATH" "$PUBLIC_SIZE_REPORT_PATH"
fi

phase "App signature verification started"
codesign --verify --deep --strict "$APP_PATH"
# --deep does not validate nested Mach-O binaries in non-standard locations
# (bare executables under Resources/, prebuilt libraries deep inside
# node_modules). v0.2.0-rc.8 shipped DMGs whose embedded node runtime and
# node-pty x64 prebuilds carried stale signatures; macOS AMFI SIGKILLs them
# at first load. Verify every embedded Mach-O individually before shipping.
macho_failures=0
while IFS= read -r candidate; do
  if ! codesign --verify --strict "$candidate" >/dev/null 2>&1; then
    echo "Invalid or missing signature on embedded Mach-O: $candidate" >&2
    macho_failures=$((macho_failures + 1))
  fi
done < <(find "$APP_PATH" -type f -print0 | xargs -0 file | sed -n 's/^\(.*\): Mach-O.*$/\1/p')
if [[ "$macho_failures" -ne 0 ]]; then
  echo "Release gate failed: $macho_failures embedded Mach-O file(s) failed signature verification." >&2
  exit 5
fi
phase "App signature verification completed"

STAGING_DIR="$WORK_DIR/dmg"
mkdir -p "$STAGING_DIR"
ditto "$APP_PATH" "$STAGING_DIR/$(basename "$APP_PATH")"
ln -s /Applications "$STAGING_DIR/Applications"
hdiutil create -volname "DeepSeek Desktop (Unofficial) - $ARCH_DISPLAY_LABEL" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH" >/dev/null
hdiutil verify "$DMG_PATH" >/dev/null
phase "DMG created and verified"

cp "$STACK_DIR/verification.receipt.json" "$RECEIPT_PATH"
(cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$DMG_PATH")" > "$(basename "$DMG_PATH").sha256")

echo "RELEASE_ARTIFACT"
echo "Architecture: $ARCH"
echo "App: $APP_PATH"
echo "DMG: $DMG_PATH"
echo "Receipt: $RECEIPT_PATH"
echo "Size report: $PUBLIC_SIZE_REPORT_PATH"
echo "SHA256: $OUTPUT_DIR/$(basename "$DMG_PATH").sha256"
if [[ -n "$SIGNING_IDENTITY" ]]; then
  echo "Signing: $SIGNING_IDENTITY + Hardened Runtime"
else
  echo "Signing: ad-hoc (Developer ID credential not supplied)"
fi

if [[ -n "$NOTARY_PROFILE" ]]; then
  if [[ -z "$SIGNING_IDENTITY" ]]; then
    echo "Notarization blocked: DSH_STACK_NOTARY_PROFILE requires a Developer ID signing identity." >&2
    exit 4
  fi
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
  echo "Notarization: submitted, stapled, and validated"
else
  echo "Notarization: PENDING (set DSH_STACK_NOTARY_PROFILE after storing credentials with xcrun notarytool)"
fi
