import { DshStackError, diagnostic } from './errors.ts'
import type { DistributionUpdateAsset, DistributionUpdateManifest } from './types.ts'

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `${field} must be a non-empty string`, {
    component: field,
    action: 'Publish a complete Update Manifest and retry the update check.',
  }), 3)
  return value
}

function httpsUrl(value: unknown, field: string): string {
  const text = stringValue(value, field)
  let url: URL
  try { url = new URL(text) } catch {
    throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `${field} is not a valid URL`, {
      component: field,
      action: 'Use an HTTPS URL for release metadata and App assets.',
    }), 3)
  }
  if (url.protocol !== 'https:') throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `${field} must use HTTPS`, {
    component: field,
    action: 'Serve update metadata and assets over HTTPS.',
  }), 3)
  return url.href
}

function sha256(value: unknown, field: string): string {
  const text = stringValue(value, field).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `${field} must be a 64-character SHA-256 hex digest`, {
    component: field,
    action: 'Publish the SHA-256 digest generated from the exact release asset.',
  }), 3)
  return text
}

function artifactIntegrity(value: unknown, field: string): string {
  const text = stringValue(value, field).toLowerCase()
  if (!/^sha256-[a-f0-9]{64}$/u.test(text)) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `${field} must be a sha256- prefixed artifact hash`, {
    component: field,
    action: 'Publish the exact artifactHash from stack.integrity.json.',
  }), 3)
  return text
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `${field} must be an object`, {
    component: field,
    action: 'Publish the documented Update Manifest shape.',
  }), 3)
  return value as Record<string, unknown>
}

function assetValue(value: unknown, index: number): DistributionUpdateAsset {
  const object = objectValue(value, `assets[${index}]`)
  const arch = stringValue(object.arch, `assets[${index}].arch`)
  if (arch !== 'x64' && arch !== 'arm64') throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `assets[${index}].arch is unsupported: ${arch}`, {
    component: `assets[${index}].arch`,
    action: 'Publish one asset for x64 or arm64.',
  }), 3)
  const asset: DistributionUpdateAsset = {
    arch,
    url: httpsUrl(object.url, `assets[${index}].url`),
    sha256: sha256(object.sha256, `assets[${index}].sha256`),
  }
  if (object.bytes !== undefined) {
    if (typeof object.bytes !== 'number' || !Number.isSafeInteger(object.bytes) || object.bytes <= 0) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `assets[${index}].bytes must be a positive integer`, {
      component: `assets[${index}].bytes`,
      action: 'Publish the exact positive asset byte size.',
    }), 3)
    asset.bytes = object.bytes
  }
  if (object.receiptUrl !== undefined) asset.receiptUrl = httpsUrl(object.receiptUrl, `assets[${index}].receiptUrl`)
  return asset
}

/** Validate release metadata before an App considers an update candidate. */
export function validateUpdateManifest(value: unknown, expected?: { distributionId?: string; arch?: 'x64' | 'arm64'; channel?: 'stable' | 'rc' }): DistributionUpdateManifest {
  const object = objectValue(value, 'Update Manifest')
  if (object.schemaVersion !== 1) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', 'Update Manifest schemaVersion must be 1', {
    component: 'schemaVersion',
    action: 'Publish a supported Update Manifest schema.',
  }), 3)
  const distributionId = stringValue(object.distributionId, 'distributionId')
  if (expected?.distributionId !== undefined && distributionId !== expected.distributionId) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `Update Manifest distributionId ${distributionId} does not match ${expected.distributionId}`, {
    component: 'distributionId',
    action: 'Do not install an update from another Distribution.',
  }), 3)
  const channel = stringValue(object.channel, 'channel')
  if (channel !== 'stable' && channel !== 'rc') throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `Unsupported update channel: ${channel}`, {
    component: 'channel',
    action: 'Use stable or rc explicitly.',
  }), 3)
  if (expected?.channel !== undefined && channel !== expected.channel) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', `Update channel ${channel} does not match the configured ${expected.channel} channel`, {
    component: 'channel',
    action: 'Select the matching release channel before checking for updates.',
  }), 3)
  const assetsValue = object.assets
  if (!Array.isArray(assetsValue) || assetsValue.length === 0) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', 'Update Manifest must contain at least one App asset', {
    component: 'assets',
    action: 'Publish an architecture-specific App asset.',
  }), 3)
  const assets = assetsValue.map((asset, index) => assetValue(asset, index))
  if (new Set(assets.map(asset => asset.arch)).size !== assets.length) throw new DshStackError(diagnostic('UPDATE_MANIFEST_INVALID', 'UPDATE_CHECK', 'Update Manifest contains duplicate architecture assets', {
    component: 'assets',
    action: 'Publish at most one asset per architecture.',
  }), 3)
  if (expected?.arch !== undefined && !assets.some(asset => asset.arch === expected.arch)) throw new DshStackError(diagnostic('UPDATE_ASSET_MISSING', 'UPDATE_CHECK', `No update asset is published for ${expected.arch}`, {
    component: 'assets',
    action: 'Keep the current App and wait for a matching architecture asset.',
  }), 2)
  const manifest: DistributionUpdateManifest = {
    schemaVersion: 1,
    distributionId,
    channel,
    appVersion: stringValue(object.appVersion, 'appVersion'),
    baseVersion: stringValue(object.baseVersion, 'baseVersion'),
    baseIntegrity: artifactIntegrity(object.baseIntegrity, 'baseIntegrity'),
    harnessVersion: stringValue(object.harnessVersion, 'harnessVersion'),
    minimumMacOS: stringValue(object.minimumMacOS, 'minimumMacOS'),
    assets,
  }
  if (object.releaseNotesUrl !== undefined) manifest.releaseNotesUrl = httpsUrl(object.releaseNotesUrl, 'releaseNotesUrl')
  if (object.publishedAt !== undefined) manifest.publishedAt = stringValue(object.publishedAt, 'publishedAt')
  return manifest
}

export function selectUpdateAsset(manifest: DistributionUpdateManifest, arch: 'x64' | 'arm64'): DistributionUpdateAsset {
  const asset = manifest.assets.find(item => item.arch === arch)
  if (asset === undefined) throw new DshStackError(diagnostic('UPDATE_ASSET_MISSING', 'UPDATE_CHECK', `No update asset is published for ${arch}`, {
    component: 'assets',
    action: 'Keep the current App and wait for a matching architecture asset.',
  }), 2)
  return asset
}
