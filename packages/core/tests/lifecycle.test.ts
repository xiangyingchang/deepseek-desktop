import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import * as yaml from 'js-yaml'
import {
  atomicSwitchProfile,
  detectProfileDrift,
  importShareableStack,
  packShareableStack,
  rebaseProfiles,
  rebaseStack,
  verifyThenAtomicSwitch,
  writeIntegrity,
  writeYaml,
  type VerificationReceipt,
} from '../src/index.ts'

async function profile(root: string, name: string, manifest: Record<string, unknown>, patch = '[]\n'): Promise<string> {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await writeFile(join(directory, 'cordis.patch.yml'), patch, 'utf8')
  await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n', 'utf8')
  return directory
}

function packageManifest(bundles: string[], dependencies: Record<string, string> = {}): Record<string, unknown> {
  return {
    name: 'dsh-profile-test',
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }
}

test('drift detection reports Profile-owned changes and excludes user state', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-drift-'))
  try {
    const base = await profile(root, 'base', packageManifest(['base']))
    const current = await profile(root, 'current', packageManifest(['base', 'plugin-x'], { 'plugin-x': '1.0.0' }))
    await mkdir(join(current, 'sessions'), { recursive: true })
    await writeFile(join(current, 'sessions', 'private.json'), 'do not capture\n', 'utf8')
    const report = await detectProfileDrift(base, current)
    assert.equal(report.status, 'MODIFIED')
    assert.deepEqual(report.delta.added, [])
    assert.deepEqual(report.delta.modified, ['package.json'])
    assert.deepEqual(report.delta.excluded, ['sessions'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('three-way rebase combines user and Base plugin additions without a second manifest', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-rebase-'))
  try {
    const base = await profile(root, 'base', packageManifest(['base']))
    const current = await profile(root, 'current', packageManifest(['base', 'plugin-x'], { 'plugin-x': '1.0.0' }), '- id: plugin-x\n  enabled: true\n')
    const next = await profile(root, 'next', packageManifest(['base', 'plugin-c'], { 'plugin-c': '2.0.0' }), '- id: plugin-c\n  enabled: true\n')
    const output = join(root, 'merged')
    const report = await rebaseProfiles({ oldBaseProfile: base, currentProfile: current, newBaseProfile: next, outputProfile: output })
    assert.equal(report.status, 'PASS')
    const manifest = JSON.parse(await readFile(join(output, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    assert.deepEqual(manifest.dependencies, { 'plugin-c': '2.0.0', 'plugin-x': '1.0.0' })
    assert.deepEqual(manifest.dsh.profile.bundles, ['base', 'plugin-c', 'plugin-x'])
    const patch = await readFile(join(output, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /plugin-c/u)
    assert.match(patch, /plugin-x/u)
    assert.doesNotMatch(patch, /bundledPlugins/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rebase returns UPDATE_REBASE_CONFLICT and writes no candidate for ambiguous plugin changes', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-conflict-'))
  try {
    const base = await profile(root, 'base', packageManifest(['base', 'plugin-x'], { 'plugin-x': '1.0.0' }))
    const current = await profile(root, 'current', packageManifest(['base', 'plugin-x'], { 'plugin-x': '1.1.0' }))
    const next = await profile(root, 'next', packageManifest(['base', 'plugin-x'], { 'plugin-x': '1.2.0' }))
    const output = join(root, 'candidate')
    const report = await rebaseProfiles({ oldBaseProfile: base, currentProfile: current, newBaseProfile: next, outputProfile: output })
    assert.equal(report.status, 'UPDATE_REBASE_CONFLICT')
    assert.equal(report.conflicts.some(item => item.path === 'package.json'), true)
    await assert.rejects(readFile(join(output, 'package.json')))
    const currentManifest = JSON.parse(await readFile(join(current, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    assert.equal(currentManifest.dependencies['plugin-x'], '1.1.0')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Native App Rebase matches core Rebase and overlays the new Base dependency closure', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-parity-'))
  try {
    const base = await profile(root, 'base', packageManifest(['base']))
    const current = await profile(root, 'current', packageManifest(['base', 'plugin-x'], { 'plugin-x': '1.0.0' }), '- id: plugin-x\n  enabled: true\n')
    const next = await profile(root, 'next', packageManifest(['base', 'plugin-c'], { 'plugin-c': '2.0.0' }), '- id: plugin-c\n  enabled: true\n')
    await mkdir(join(current, 'node_modules', 'plugin-x'), { recursive: true })
    await mkdir(join(current, 'node_modules', 'shared'), { recursive: true })
    await writeFile(join(current, 'node_modules', 'plugin-x', 'package.json'), '{"name":"plugin-x"}\n', 'utf8')
    await writeFile(join(current, 'node_modules', 'shared', 'version.txt'), 'old\n', 'utf8')
    await mkdir(join(next, 'node_modules', 'shared'), { recursive: true })
    await writeFile(join(next, 'node_modules', 'shared', 'version.txt'), 'new\n', 'utf8')
    const coreOutput = join(root, 'core-output')
    const runtimeOutput = join(root, 'runtime-output')
    const runtime = await import(new URL('../assets/profile-rebase.mjs', import.meta.url).href) as unknown as {
      rebaseProfiles(options: { oldBase: string; current: string; newBase: string; output: string; yaml: typeof yaml }): Promise<{ status: string; conflicts: unknown[] }>
      mergeDependencyClosure(options: { baseProfile: string; currentProfile: string; candidateProfile: string }): Promise<void>
    }
    const coreReport = await rebaseProfiles({ oldBaseProfile: base, currentProfile: current, newBaseProfile: next, outputProfile: coreOutput })
    const runtimeReport = await runtime.rebaseProfiles({ oldBase: base, current, newBase: next, output: runtimeOutput, yaml })
    assert.equal(runtimeReport.status, coreReport.status)
    assert.deepEqual(runtimeReport.conflicts, coreReport.conflicts)
    for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
      assert.equal(await readFile(join(runtimeOutput, file), 'utf8'), await readFile(join(coreOutput, file), 'utf8'))
    }
    await runtime.mergeDependencyClosure({ baseProfile: next, currentProfile: current, candidateProfile: runtimeOutput })
    assert.equal(await readFile(join(runtimeOutput, 'node_modules', 'plugin-x', 'package.json'), 'utf8'), '{"name":"plugin-x"}\n')
    assert.equal(await readFile(join(runtimeOutput, 'node_modules', 'shared', 'version.txt'), 'utf8'), 'new\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Stack Rebase rejects a Current Derived Stack with the wrong Base lineage', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-lineage-'))
  try {
    const createStack = async (name: string, id: string, version: string, kind: 'base' | 'derived', base?: { id: string; version: string; integrity: string }) => {
      const stack = join(root, name)
      await mkdir(join(stack, 'profile'), { recursive: true })
      await mkdir(join(stack, 'tests'), { recursive: true })
      await writeFile(join(stack, 'stack.yaml'), writeYaml({ schemaVersion: 1, id, name: id, version, description: id, harness: { version: 'test', adapter: 'test', profile: 'web' }, profile: { source: './profile', inputs: ['package.json'] }, environment: { node: { observed: process.version }, pnpm: { observed: 'test' }, platform: { os: [process.platform], arch: [process.arch] } }, requirements: { secrets: [] }, source: { consistency: 'verified' }, verification: { tests: ['./tests/smoke.yaml'] } }), 'utf8')
      await writeFile(join(stack, 'profile', 'package.json'), JSON.stringify(packageManifest(['base'])) + '\n', 'utf8')
      await writeFile(join(stack, 'tests', 'smoke.yaml'), 'mode: runtime\n', 'utf8')
      await writeFile(join(stack, 'distribution.yaml'), writeYaml({ schemaVersion: 1, kind, id, version, channel: kind === 'base' ? 'rc' : 'working', harness: { version: 'test', adapter: 'test', profile: 'web' }, profile: { source: './profile' }, ...(base === undefined ? {} : { base }), release: { createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'dsh-stack' } }), 'utf8')
      await writeIntegrity(stack)
      return stack
    }
    const oldBase = await createStack('old-base', 'dsh-web', '1.0.0', 'base')
    const current = await createStack('current', 'dsh-web-derived', '1.0.0', 'derived', { id: 'other-base', version: '9.0.0', integrity: 'sha256-other' })
    const nextBase = await createStack('next-base', 'dsh-web', '2.0.0', 'base')
    await assert.rejects(
      rebaseStack({ oldBaseStack: oldBase, currentDerivedStack: current, newBaseStack: nextBase, outputStack: join(root, 'candidate') }),
      /does not descend from the supplied Old Base/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('atomic switch keeps the old active Profile when verification fails', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-switch-'))
  try {
    const active = join(root, 'active')
    const candidate = join(root, 'candidate')
    await mkdir(active, { recursive: true })
    await mkdir(candidate, { recursive: true })
    await writeFile(join(active, 'state.txt'), 'old\n', 'utf8')
    await writeFile(join(candidate, 'state.txt'), 'new\n', 'utf8')
    await assert.rejects(verifyThenAtomicSwitch({ candidateProfile: candidate, activeProfile: active, verify: async () => ({ result: 'fail' }) }), /Candidate verification returned FAIL/u)
    assert.equal(await readFile(join(active, 'state.txt'), 'utf8'), 'old\n')
    const switchCandidate = join(root, 'candidate-pass')
    await mkdir(switchCandidate, { recursive: true })
    await writeFile(join(switchCandidate, 'state.txt'), 'new\n', 'utf8')
    await verifyThenAtomicSwitch({ candidateProfile: switchCandidate, activeProfile: active, verify: async () => ({ result: 'pass' }) })
    assert.equal(await readFile(join(active, 'state.txt'), 'utf8'), 'new\n')
    assert.equal(await readFile(join(active + '.previous', 'state.txt'), 'utf8'), 'old\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pack and import create a state-free .dshstack with bound receipt', async () => {
  try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); execFileSync('unzip', ['-v'], { stdio: 'ignore' }) } catch { return }
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-share-'))
  try {
    const stack = join(root, 'stack')
    await mkdir(join(stack, 'profile'), { recursive: true })
    await mkdir(join(stack, 'tests'), { recursive: true })
    await writeFile(join(stack, 'stack.yaml'), writeYaml({ schemaVersion: 1, id: 'dsh-test', name: 'test', version: '1.0.0', description: 'test', harness: { version: 'test', adapter: 'test', profile: 'web' }, profile: { source: './profile', inputs: ['package.json'] }, environment: { node: { observed: process.version }, pnpm: { observed: 'test' }, platform: { os: [process.platform], arch: [process.arch] } }, requirements: { secrets: [] }, source: { consistency: 'verified' }, verification: { tests: ['./tests/smoke.yaml'] } }), 'utf8')
    await writeFile(join(stack, 'profile', 'package.json'), '{"name":"dsh-test"}\n', 'utf8')
    await writeFile(join(stack, 'tests', 'smoke.yaml'), 'mode: runtime\n', 'utf8')
    const integrity = await writeIntegrity(stack)
    const receipt: VerificationReceipt = {
      schemaVersion: 1,
      stack: { id: 'dsh-test', version: '1.0.0', integrity: integrity.artifactHash },
      verification: { level: 'runtime', result: 'pass', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', cacheUsed: false },
      environment: { os: process.platform, arch: process.arch, node: process.version, pnpm: 'test', clean: true },
      harness: { version: 'test', mode: 'source' },
      profile: { name: 'web', generatedFiles: ['cordis.yml'] },
      thirdPartyCodeExecuted: true,
      externalServices: { llm: false, network: ['localhost Web UI readiness'] },
      stages: ['STATIC_VERIFY', 'MATERIALIZE', 'BOOT', 'ACTIVATE', 'CORE_TEST'].map(stage => ({ stage: stage as VerificationReceipt['stages'][number]['stage'], status: 'passed' as const, at: '2026-01-01T00:00:01.000Z' })),
      checks: [],
      diagnostics: [],
    }
    await writeFile(join(stack, 'verification.receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8')
    const archive = join(root, 'setup.dshstack')
    const packed = await packShareableStack({ stackRoot: stack, output: archive, verify: async () => ({ receipt, receiptPath: join(stack, 'verification.receipt.json'), exitCode: 0 }) })
    assert.equal(packed.output, archive)
    const imported = await importShareableStack({ archive, output: join(root, 'imported') })
    assert.equal(imported.output.endsWith('/imported'), true)
    assert.equal(await readFile(join(imported.output, 'profile', 'package.json'), 'utf8'), '{"name":"dsh-test"}\n')
    await writeFile(join(stack, 'verification.receipt.json'), JSON.stringify({ ...receipt, harness: { version: 'tampered', mode: 'source' } }, null, 2) + '\n', 'utf8')
    await assert.rejects(
      packShareableStack({ stackRoot: stack, output: join(root, 'tampered.dshstack'), verify: async () => ({ receipt, receiptPath: join(stack, 'verification.receipt.json'), exitCode: 0 }) }),
      /Receipt changed after Verify/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Pack rejects symbolic links before creating a share artifact', async () => {
  try { execFileSync('zip', ['-v'], { stdio: 'ignore' }) } catch { return }
  const root = await mkdtemp(join('/tmp', 'dsh-stack-lifecycle-symlink-'))
  try {
    const stack = join(root, 'stack')
    await mkdir(join(stack, 'profile'), { recursive: true })
    await mkdir(join(stack, 'tests'), { recursive: true })
    await writeFile(join(stack, 'stack.yaml'), writeYaml({ schemaVersion: 1, id: 'dsh-test', name: 'test', version: '1.0.0', description: 'test', harness: { version: 'test', adapter: 'test', profile: 'web' }, profile: { source: './profile', inputs: ['package.json'] }, environment: { node: { observed: process.version }, pnpm: { observed: 'test' }, platform: { os: [process.platform], arch: [process.arch] } }, requirements: { secrets: [] }, source: { consistency: 'verified' }, verification: { tests: ['./tests/smoke.yaml'] } }), 'utf8')
    await writeFile(join(stack, 'profile', 'package.json'), '{"name":"dsh-test"}\n', 'utf8')
    await writeFile(join(stack, 'tests', 'smoke.yaml'), 'mode: runtime\n', 'utf8')
    const integrity = await writeIntegrity(stack)
    const receipt: VerificationReceipt = {
      schemaVersion: 1,
      stack: { id: 'dsh-test', version: '1.0.0', integrity: integrity.artifactHash },
      verification: { level: 'runtime', result: 'pass', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', cacheUsed: false },
      environment: { os: process.platform, arch: process.arch, node: process.version, pnpm: 'test', clean: true },
      harness: { version: 'test', mode: 'source' },
      profile: { name: 'web', generatedFiles: ['cordis.yml'] },
      thirdPartyCodeExecuted: true,
      externalServices: { llm: false, network: ['localhost Web UI readiness'] },
      stages: ['STATIC_VERIFY', 'MATERIALIZE', 'BOOT', 'ACTIVATE', 'CORE_TEST'].map(stage => ({ stage: stage as VerificationReceipt['stages'][number]['stage'], status: 'passed' as const, at: '2026-01-01T00:00:01.000Z' })),
      checks: [],
      diagnostics: [],
    }
    await writeFile(join(stack, 'verification.receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8')
    await writeFile(join(root, 'outside.txt'), 'outside\n', 'utf8')
    await symlink(join(root, 'outside.txt'), join(stack, 'profile', 'outside-link'))
    await assert.rejects(
      packShareableStack({ stackRoot: stack, output: join(root, 'setup.dshstack'), verify: async () => ({ receipt, receiptPath: join(stack, 'verification.receipt.json'), exitCode: 0 }) }),
      /symbolic links|integrity/u,
    )
    await assert.rejects(access(join(root, 'setup.dshstack')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
