import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const scriptPath = fileURLToPath(new URL('../../../scripts/update-harness-pin.mjs', import.meta.url))

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFile('git', args, { cwd, encoding: 'utf8' })
  return result.stdout.trim()
}

async function createHarness(root: string, version = '0.1.0-rc.8'): Promise<string> {
  await mkdir(join(root, 'apps', 'cli'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{"name":"@deepseek-ai/dsh-root","version":"' + version + '"}\n')
  await writeFile(join(root, 'apps', 'cli', 'package.json'), '{"name":"@deepseek-ai/dsh","version":"' + version + '"}\n')
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  await git(root, ['init', '-b', 'master'])
  await git(root, ['add', '.'])
  await git(root, ['-c', 'user.name=DSH Stack Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'])
  await git(root, ['remote', 'add', 'origin', 'https://github.com/deepseek-ai/deepseek-harness.git'])
  return git(root, ['rev-parse', 'HEAD'])
}

async function runPromotion(harness: string, pin: string): Promise<{ stdout: string; stderr: string }> {
  return execFile(process.execPath, [scriptPath, '--harness', harness, '--pin', pin])
}

test('Harness pin promotion records the clean official checkout commit and version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harness-pin-test-'))
  const harness = join(root, 'deepseek-harness')
  const pin = join(root, 'harness-pin.json')
  const commit = await createHarness(harness)
  await writeFile(pin, `${JSON.stringify({
    schemaVersion: 1,
    repository: 'deepseek-ai/deepseek-harness',
    version: '0.1.0-rc.7',
    commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
    upstreamRef: 'master',
  }, null, 2)}\n`)

  const result = await runPromotion(harness, pin)
  assert.match(result.stdout, /Harness pin updated: 0\.1\.0-rc\.8/)
  const updated = JSON.parse(await readFile(pin, 'utf8'))
  assert.equal(updated.version, '0.1.0-rc.8')
  assert.equal(updated.commit, commit)
  assert.equal(updated.upstreamRef, 'master')
})

test('Harness pin promotion refuses a dirty checkout without changing the pin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harness-pin-dirty-test-'))
  const harness = join(root, 'deepseek-harness')
  const pin = join(root, 'harness-pin.json')
  await createHarness(harness)
  const original = {
    schemaVersion: 1,
    repository: 'deepseek-ai/deepseek-harness',
    version: '0.1.0-rc.7',
    commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
    upstreamRef: 'master',
  }
  await writeFile(pin, `${JSON.stringify(original, null, 2)}\n`)
  await writeFile(join(harness, 'local-change.txt'), 'do not promote\n')

  await assert.rejects(runPromotion(harness, pin), /Harness checkout is dirty/)
  assert.deepEqual(JSON.parse(await readFile(pin, 'utf8')), original)
})
