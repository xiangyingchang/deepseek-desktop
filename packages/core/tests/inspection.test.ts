import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { SourceHarnessAdapter, type HarnessInstallation } from '../src/index.ts'

test('inspection resolves a configuration-only bundle without a main entry', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-inspection-'))
  const cli = join(root, 'harness', 'apps', 'cli')
  const profile = join(root, 'home', 'profiles', 'no-main')
  const bundle = join(profile, 'node_modules', 'no-main-bundle')
  await mkdir(cli, { recursive: true })
  await mkdir(bundle, { recursive: true })
  await writeFile(join(cli, 'package.json'), '{"name":"fake-cli"}\n', 'utf8')
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-no-main',
    dsh: { profile: { bundles: ['no-main-bundle'] } },
  }) + '\n', 'utf8')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n', 'utf8')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({
    name: 'no-main-bundle',
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }) + '\n', 'utf8')
  await writeFile(join(bundle, 'cordis.patch.yml'), '[]\n', 'utf8')
  const installation: HarnessInstallation = {
    mode: 'source',
    root: join(root, 'harness'),
    cliPackagePath: join(cli, 'package.json'),
    version: '0.0.0-test',
    observedNode: process.version,
    observedPackageManager: 'pnpm-test',
    cliCommand: ['dsh'],
    cliCwd: join(root, 'harness'),
    web: { command: ['web'], defaultHost: '127.0.0.1', defaultPort: 3080, url: 'http://127.0.0.1:3080', official: true },
  }
  const inspection = await new SourceHarnessAdapter().inspectProfile(installation, 'no-main', { dshHome: join(root, 'home') })
  assert.deepEqual(inspection.bundles, [{
    name: 'no-main-bundle',
    packageDir: await realpath(bundle),
    packageVersion: '1.0.0',
    patchPath: join(await realpath(bundle), 'cordis.patch.yml'),
    patchReferences: [],
    lifecycleScripts: [],
    resolved: true,
    hasBundleDeclaration: true,
  }])
  await rm(root, { recursive: true, force: true })
})

test('inspection excludes generated, cache, session, and credential files from Profile inputs', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-inspection-'))
  const cli = join(root, 'harness', 'apps', 'cli')
  const profile = join(root, 'home', 'profiles', 'data')
  await mkdir(cli, { recursive: true })
  await mkdir(join(profile, '.cache'), { recursive: true })
  await mkdir(join(profile, 'sessions'), { recursive: true })
  await writeFile(join(cli, 'package.json'), '{"name":"fake-cli"}\n', 'utf8')
  await writeFile(join(profile, 'package.json'), '{"name":"dsh-profile-data"}\n', 'utf8')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n', 'utf8')
  await writeFile(join(profile, '.cache', 'generated.json'), '{}\n', 'utf8')
  await writeFile(join(profile, 'sessions', 'session.jsonl'), '{}\n', 'utf8')
  await writeFile(join(profile, '.credentials.yaml'), 'apiKey: sk-never-copy-this\n', 'utf8')
  const installation: HarnessInstallation = {
    mode: 'source',
    root: join(root, 'harness'),
    cliPackagePath: join(cli, 'package.json'),
    version: '0.0.0-test',
    observedNode: process.version,
    observedPackageManager: 'pnpm-test',
    cliCommand: ['dsh'],
    cliCwd: join(root, 'harness'),
    web: { command: ['web'], defaultHost: '127.0.0.1', defaultPort: 3080, url: 'http://127.0.0.1:3080', official: true },
  }
  const inspection = await new SourceHarnessAdapter().inspectProfile(installation, 'data', { dshHome: join(root, 'home') })
  assert.deepEqual(inspection.inputs.map(input => input.relativePath).sort(), ['cordis.patch.yml', 'package.json'])
  await rm(root, { recursive: true, force: true })
})
