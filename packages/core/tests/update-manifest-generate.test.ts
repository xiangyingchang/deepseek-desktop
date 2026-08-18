import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { selectUpdateAsset, validateUpdateManifest } from '../src/update-manifest.ts'

// The generator is an executable .mjs boundary rather than a TypeScript package
// module. Keep the test import aligned with the runtime loading path used by the
// App assets, instead of teaching the core package to compile external scripts.
const { buildUpdateManifest, parseGitHubRepo } = await import(new URL('../../../scripts/generate-update-manifest.mjs', import.meta.url).href)
const { buildCombinedUpdateManifest, mergeUpdateManifests } = await import(new URL('../../../scripts/merge-update-manifest.mjs', import.meta.url).href)

const digest = 'b'.repeat(64)

async function stageDist(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'dsh-manifest-'))
  const appResources = join(dist, 'DeepSeek Desktop (Unofficial).app', 'Contents', 'Resources')
  await mkdir(appResources, { recursive: true })
  await writeFile(join(appResources, 'client.json'), JSON.stringify({
    id: 'dsh-web',
    storageId: 'dsh-web-5590c2a0cb00b3a7',
    architecture: 'x64',
    appVersion: '0.2.0-rc.10',
    baseVersion: '0.1.0',
    baseIntegrity: `sha256-${digest}`,
    updateChannel: 'rc',
    distributionKind: 'base',
    profile: 'web',
    secrets: ['DEEPSEEK_API_KEY'],
  }))
  await writeFile(join(appResources, 'verification.receipt.json'), JSON.stringify({
    stack: { id: 'dsh-web', version: '0.1.0', integrity: `sha256-${digest}` },
    harness: { version: '0.1.0-rc.5' },
  }))
  await writeFile(join(dist, 'DeepSeek Desktop (Unofficial).app', 'Contents', 'Info.plist'), `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict></plist>`)
  await writeFile(join(dist, 'DeepSeek-Desktop-Unofficial-macos-Intel-x86_64.dmg'), 'fake dmg payload')
  await writeFile(join(dist, 'DeepSeek-Desktop-Unofficial-macos-Intel-x86_64.dmg.sha256'), `${digest}  DeepSeek-Desktop-Unofficial-macos-Intel-x86_64.dmg\n`)
  await writeFile(join(dist, 'DeepSeek-Desktop-Unofficial-macos-Intel-x86_64-verification.receipt.json'), '{}')
  return dist
}

test('generator derives a valid manifest from a release output directory', async () => {
  const dist = await stageDist()
  const manifest = await buildUpdateManifest({
    distDir: dist,
    tag: 'v0.2.0-rc.10',
    repo: 'xiangyingchang/deepseek-desktop',
    publishedAt: '2026-08-18T00:00:00.000Z',
  })
  const validated = validateUpdateManifest(manifest, { distributionId: 'dsh-web', arch: 'x64', channel: 'rc' })
  assert.equal(validated.appVersion, '0.2.0-rc.10')
  assert.equal(validated.harnessVersion, '0.1.0-rc.5')
  assert.equal(validated.minimumMacOS, '12.0')
  assert.equal(validated.publishedAt, '2026-08-18T00:00:00.000Z')
  const asset = selectUpdateAsset(validated, 'x64')
  assert.equal(asset.sha256, digest)
  assert.equal(asset.url, 'https://github.com/xiangyingchang/deepseek-desktop/releases/download/v0.2.0-rc.10/DeepSeek-Desktop-Unofficial-macos-Intel-x86_64.dmg')
  assert.equal(asset.receiptUrl, 'https://github.com/xiangyingchang/deepseek-desktop/releases/download/v0.2.0-rc.10/DeepSeek-Desktop-Unofficial-macos-Intel-x86_64-verification.receipt.json')
  assert.equal(asset.bytes, 'fake dmg payload'.length)
})

test('generator refuses an incomplete or tampered release directory', async () => {
  const dist = await stageDist()
  await writeFile(join(dist, 'DeepSeek-Desktop-Unofficial-macos-Intel-x86_64.dmg.sha256'), 'not-a-digest\n')
  await assert.rejects(
    buildUpdateManifest({ distDir: dist, tag: 'v0.2.0-rc.10', repo: 'xiangyingchang/deepseek-desktop' }),
    /hex digest/u,
  )
  await assert.rejects(
    buildUpdateManifest({ distDir: dist, tag: 'v0.2.0-rc.10', repo: 'xiangyingchang/deepseek-desktop', channel: 'beta' }),
    /stable or rc/u,
  )
})

test('generator parses HTTPS and SSH GitHub remotes into owner/name', () => {
  assert.equal(parseGitHubRepo('https://github.com/xiangyingchang/deepseek-desktop.git'), 'xiangyingchang/deepseek-desktop')
  assert.equal(parseGitHubRepo('git@github.com:xiangyingchang/deepseek-desktop'), 'xiangyingchang/deepseek-desktop')
  assert.equal(parseGitHubRepo('https://gitlab.com/example/repo.git'), undefined)
})

test('merge combines one validated asset per architecture with stable metadata', async () => {
  const x64 = await stageDist()
  const arm64 = await stageDist()
  const armApp = join(arm64, 'DeepSeek Desktop (Unofficial).app')
  const armClientPath = join(armApp, 'Contents', 'Resources', 'client.json')
  const armClient = JSON.parse(await readFile(armClientPath, 'utf8'))
  armClient.architecture = 'arm64'
  await writeFile(armClientPath, JSON.stringify(armClient))
  await rename(join(arm64, 'DeepSeek-Desktop-Unofficial-macos-Intel-x86_64.dmg'), join(arm64, 'DeepSeek-Desktop-Unofficial-macos-Apple-Silicon-arm64.dmg'))
  await rename(join(arm64, 'DeepSeek-Desktop-Unofficial-macos-Intel-x86_64.dmg.sha256'), join(arm64, 'DeepSeek-Desktop-Unofficial-macos-Apple-Silicon-arm64.dmg.sha256'))
  await rename(join(arm64, 'DeepSeek-Desktop-Unofficial-macos-Intel-x86_64-verification.receipt.json'), join(arm64, 'DeepSeek-Desktop-Unofficial-macos-Apple-Silicon-arm64-verification.receipt.json'))
  await writeFile(join(arm64, 'DeepSeek-Desktop-Unofficial-macos-Apple-Silicon-arm64.dmg.sha256'), `${digest}  DeepSeek-Desktop-Unofficial-macos-Apple-Silicon-arm64.dmg\n`)
  const manifest = await buildCombinedUpdateManifest({
    distDirs: [arm64, x64],
    tag: 'v0.2.0-rc.12',
    repo: 'xiangyingchang/deepseek-desktop',
    publishedAt: '2026-08-18T00:00:00.000Z',
  })
  assert.deepEqual(manifest.assets.map((asset: { arch: string }) => asset.arch), ['x64', 'arm64'])
  assert.equal(manifest.appVersion, '0.2.0-rc.10')
})

test('merge uses the newest publication time when architecture builds finish separately', () => {
  const base = {
    schemaVersion: 1,
    distributionId: 'dsh-web',
    channel: 'rc',
    appVersion: '0.2.0-rc.12',
    baseVersion: '0.1.0',
    baseIntegrity: `sha256-${digest}`,
    harnessVersion: '0.1.0-rc.7',
    minimumMacOS: '12.0',
    releaseNotesUrl: 'https://github.com/xiangyingchang/deepseek-desktop/releases',
  }
  const x64 = { ...base, publishedAt: '2026-08-18T00:00:00.000Z', assets: [{ arch: 'x64' }] }
  const arm64 = { ...base, publishedAt: '2026-08-18T00:05:00.000Z', assets: [{ arch: 'arm64' }] }
  assert.equal(mergeUpdateManifests([x64, arm64]).publishedAt, '2026-08-18T00:05:00.000Z')
})

test('merge rejects duplicate architecture assets', () => {
  const manifest = {
    schemaVersion: 1,
    distributionId: 'dsh-web',
    channel: 'rc',
    appVersion: '0.2.0-rc.12',
    baseVersion: '0.1.0',
    baseIntegrity: `sha256-${digest}`,
    harnessVersion: '0.1.0-rc.7',
    minimumMacOS: '12.0',
    releaseNotesUrl: 'https://github.com/xiangyingchang/deepseek-desktop/releases',
    publishedAt: '2026-08-18T00:00:00.000Z',
    assets: [{ arch: 'x64' }],
  }
  assert.throws(() => mergeUpdateManifests([manifest, manifest]), /duplicate asset architecture/u)
})
