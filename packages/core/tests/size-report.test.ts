import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { createPackageSizeReport } from '../src/index.ts'

test('package size report separates the exact Profile dependency closure', async () => {
  const app = await mkdtemp(join('/tmp', 'dsh-stack-size-report-'))
  await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(join(app, 'Contents', 'Resources', 'lib'), { recursive: true })
  await mkdir(join(app, 'Contents', 'Resources', 'harness'), { recursive: true })
  await mkdir(join(app, 'Contents', 'Resources', 'profile', 'node_modules', 'community-bundle'), { recursive: true })
  await writeFile(join(app, 'Contents', 'MacOS', 'shell'), Buffer.alloc(10), 'utf8')
  await writeFile(join(app, 'Contents', 'Resources', 'node'), Buffer.alloc(20), 'utf8')
  await writeFile(join(app, 'Contents', 'Resources', 'lib', 'node.dylib'), Buffer.alloc(30), 'utf8')
  await writeFile(join(app, 'Contents', 'Resources', 'harness', 'runtime.js'), Buffer.alloc(40), 'utf8')
  await writeFile(join(app, 'Contents', 'Resources', 'profile', 'package.json'), Buffer.alloc(50), 'utf8')
  await writeFile(join(app, 'Contents', 'Resources', 'profile', 'node_modules', 'community-bundle', 'package.json'), Buffer.alloc(60), 'utf8')
  await writeFile(join(app, 'Contents', 'Resources', 'client.json'), Buffer.alloc(70), 'utf8')
  const report = await createPackageSizeReport({ appPath: app, profile: 'web', architecture: 'x64' })
  assert.equal(report.categories.nativeShell.bytes, 10)
  assert.equal(report.categories.nodeRuntime.bytes, 50)
  assert.equal(report.categories.harnessRuntime.bytes, 40)
  assert.equal(report.categories.profile.bytes, 50)
  assert.equal(report.categories.profileDependencies.bytes, 60)
  assert.equal(report.categories.other.bytes, 70)
  assert.equal(report.total.bytes, 280)
  await rm(app, { recursive: true, force: true })
})
