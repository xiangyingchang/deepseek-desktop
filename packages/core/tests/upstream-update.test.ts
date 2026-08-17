import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { checkHarnessUpdate } from '../src/upstream.ts'

const execFile = promisify(execFileCallback)

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd, encoding: 'utf8' })
  return result.stdout.trim()
}

async function writeHarness(root: string, version: string): Promise<void> {
  await mkdir(join(root, 'apps', 'cli'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version, packageManager: 'pnpm@11.7.0' }) + '\n')
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  await writeFile(join(root, 'apps', 'cli', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }) + '\n')
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(cwd, ['add', '.'])
  await git(cwd, ['-c', 'user.name=DSH Stack Test', '-c', 'user.email=test@example.com', 'commit', '-m', message])
}

test('Harness update check compares a clean checkout with the official remote ref', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upstream-check-'))
  const bare = await mkdtemp(join(tmpdir(), 'dsh-upstream-remote-'))
  const publisher = await mkdtemp(join(tmpdir(), 'dsh-upstream-publisher-'))
  await git(bare, ['init', '--bare'])
  await git(root, ['init', '-b', 'master'])
  await writeHarness(root, '0.1.0-rc.5')
  await commit(root, 'rc5')
  await git(root, ['remote', 'add', 'origin', bare])
  await git(root, ['push', '-u', 'origin', 'master'])
  await git(publisher, ['clone', '--branch', 'master', bare, '.'])
  await writeHarness(publisher, '0.1.0-rc.7')
  await commit(publisher, 'rc7')
  await git(publisher, ['push', 'origin', 'master'])

  const result = await checkHarnessUpdate({ harnessRoot: root, remote: 'origin', ref: 'master' })
  assert.equal(result.status, 'UPDATE_AVAILABLE')
  assert.equal(result.current.version, '0.1.0-rc.5')
  assert.equal(result.current.dirty, false)
  assert.equal(result.candidate?.version, '0.1.0-rc.7')
  assert.equal(result.candidate?.ref, 'refs/heads/master')

  await git(root, ['merge', '--ff-only', 'origin/master'])
  const current = await checkHarnessUpdate({ harnessRoot: root, remote: 'origin', ref: 'master' })
  assert.equal(current.status, 'UP_TO_DATE')

  await writeFile(join(root, 'local-change.txt'), 'user change\n')
  const dirty = await checkHarnessUpdate({ harnessRoot: root, remote: 'origin', ref: 'master' })
  assert.equal(dirty.current.dirty, true)
})
