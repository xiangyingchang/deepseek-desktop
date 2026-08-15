import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { SourceHarnessAdapter, type ProfileInspection } from '../src/index.ts'

async function fixtureInspection(root: string, manifest: Record<string, unknown>, patch = '[]\n'): Promise<ProfileInspection> {
  const profile = join(root, 'profile')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest) + '\n', 'utf8')
  await writeFile(join(profile, 'cordis.patch.yml'), patch, 'utf8')
  const inputs = [
    { relativePath: 'package.json', absolutePath: join(profile, 'package.json'), kind: 'manifest' as const },
    { relativePath: 'cordis.patch.yml', absolutePath: join(profile, 'cordis.patch.yml'), kind: 'patch' as const },
  ]
  return {
    name: 'fixture',
    home: root,
    directory: profile,
    exists: true,
    manifestPath: join(profile, 'package.json'),
    manifest,
    inputs,
    generatedFiles: [],
    excludedEntries: [],
    missingExpectedInputs: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
    bundles: [],
    profileNodeModulesPresent: false,
    fallbackNodeModulesPresent: false,
  }
}

test('preflight rejects external dependencies without a lockfile', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-preflight-'))
  const inspection = await fixtureInspection(root, { dependencies: { example: '1.0.0' } })
  const result = await new SourceHarnessAdapter().preflight(inspection)
  assert.equal(result.status, 'INCONSISTENT')
  assert.equal(result.diagnostics.some(item => item.code === 'LOCKFILE_MISSING'), true)
  await rm(root, { recursive: true, force: true })
})

test('preflight reads pnpm v9 importer dependency sections', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-preflight-'))
  const inspection = await fixtureInspection(root, { dependencies: { example: '1.0.0' } })
  await writeFile(join(root, 'profile', 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\nimporters:\n  .:\n    dependencies:\n      example:\n        specifier: 1.0.0\n        version: 1.0.0\n', 'utf8')
  inspection.inputs.push({ relativePath: 'pnpm-lock.yaml', absolutePath: join(root, 'profile', 'pnpm-lock.yaml'), kind: 'lockfile' })
  const result = await new SourceHarnessAdapter().preflight(inspection)
  assert.equal(result.diagnostics.some(item => item.code === 'LOCKFILE_MISMATCH'), false)
  await rm(root, { recursive: true, force: true })
})

test('preflight rejects local links and floating Git refs', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-preflight-'))
  const inspection = await fixtureInspection(root, { dependencies: { local: 'link:../plugin', remote: 'github:example/plugin#main' } })
  const result = await new SourceHarnessAdapter().preflight(inspection)
  assert.equal(result.status, 'INCONSISTENT')
  assert.equal(result.diagnostics.filter(item => item.code === 'NON_PORTABLE_DEPENDENCY').length, 1)
  assert.equal(result.portability.nonPortable.length, 2)
  await rm(root, { recursive: true, force: true })
})

test('preflight blocks a secret value but keeps bare required names valid', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-preflight-'))
  const inspection = await fixtureInspection(root, {})
  const bare = await new SourceHarnessAdapter().preflight(inspection)
  assert.equal(bare.status, 'CONSISTENT')
  await writeFile(join(root, 'profile', '.env'), 'DEEPSEEK_API_KEY=sk-1234567890abcdef\n', 'utf8')
  inspection.inputs.push({ relativePath: '.env', absolutePath: join(root, 'profile', '.env'), kind: 'configuration' })
  const secret = await new SourceHarnessAdapter().preflight(inspection)
  assert.equal(secret.diagnostics.some(item => item.code === 'SECRET_DETECTED'), true)
  await rm(root, { recursive: true, force: true })
})

test('preflight preserves unevaluated Cordis JavaScript as an explicit warning', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-preflight-'))
  const inspection = await fixtureInspection(root, {}, '- id: example\n  config:\n    value: !!js/function >\n      function () { return 1 }\n')
  const result = await new SourceHarnessAdapter().preflight(inspection)
  assert.equal(result.status, 'CONSISTENT')
  assert.equal(result.warnings.some(item => item.message.includes('!!js')), true)
  await rm(root, { recursive: true, force: true })
})
