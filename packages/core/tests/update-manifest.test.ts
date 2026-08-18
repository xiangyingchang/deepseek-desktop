import assert from 'node:assert/strict'
import test from 'node:test'
import { selectUpdateAsset, validateUpdateManifest } from '../src/update-manifest.ts'

const digest = 'a'.repeat(64)

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    distributionId: 'dsh-web',
    channel: 'rc',
    appVersion: '0.2.0-rc.1',
    baseVersion: '0.2.0',
    baseIntegrity: `sha256-${digest}`,
    harnessVersion: '0.1.0-rc.6',
    minimumMacOS: '12.0',
    assets: [
      { arch: 'x64', url: 'https://github.com/example/release-x64.dmg', sha256: digest, baseIntegrity: `sha256-${digest}` },
      { arch: 'arm64', url: 'https://github.com/example/release-arm64.dmg', sha256: digest, baseIntegrity: `sha256-${digest}` },
    ],
    ...overrides,
  }
}

test('Update Manifest validates identity, HTTPS assets, and architecture selection', () => {
  const value = validateUpdateManifest(manifest(), { distributionId: 'dsh-web', arch: 'arm64', channel: 'rc' })
  assert.equal(value.appVersion, '0.2.0-rc.1')
  assert.equal(selectUpdateAsset(value, 'arm64').url, 'https://github.com/example/release-arm64.dmg')
})

test('Update Manifest rejects cross-distribution and HTTP candidates', () => {
  assert.throws(() => validateUpdateManifest(manifest({ distributionId: 'other' }), { distributionId: 'dsh-web' }), /does not match/u)
  assert.throws(() => validateUpdateManifest(manifest({ assets: [{ arch: 'x64', url: 'http://example.invalid/app.dmg', sha256: digest }] })), /must use HTTPS/u)
})

test('Update Manifest rejects missing architecture assets instead of falling back', () => {
  const onlyX64 = manifest({ assets: [{ arch: 'x64', url: 'https://github.com/example/release-x64.dmg', sha256: digest }] })
  assert.throws(() => validateUpdateManifest(onlyX64, { distributionId: 'dsh-web', arch: 'arm64' }), /No update asset/u)
})
