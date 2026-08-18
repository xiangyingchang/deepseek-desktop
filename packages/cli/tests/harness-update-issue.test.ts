import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const scriptPath = fileURLToPath(new URL('../../../scripts/harness-update-issue.mjs', import.meta.url))

const updateAvailableReport = {
  status: 'UPDATE_AVAILABLE',
  harnessRoot: '/tmp/harness',
  remote: 'origin',
  ref: 'master',
  current: { version: '0.1.0-rc.7', commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca', dirty: false },
  candidate: { version: '0.1.0-rc.8', commit: 'aaaabbbbccccdddd000011112222333344445555', ref: 'refs/heads/master' },
  observedAt: '2026-08-18T15:00:00.000Z',
}

const upToDateReport = {
  status: 'UP_TO_DATE',
  harnessRoot: '/tmp/harness',
  remote: 'origin',
  ref: 'master',
  current: { version: '0.1.0-rc.7', commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca', dirty: false },
  candidate: { version: '0.1.0-rc.7', commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca', ref: 'refs/heads/master' },
  observedAt: '2026-08-18T15:00:00.000Z',
}

async function render(report: unknown, extraArgs: readonly string[] = []): Promise<{ outDir: string; stdout: string }> {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-harness-issue-test-'))
  const checkPath = join(outDir, 'harness-check.json')
  await writeFile(checkPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const { stdout } = await execFile(process.execPath, [
    scriptPath,
    '--check', checkPath,
    '--ref', 'master',
    '--out-dir', outDir,
    ...extraArgs,
  ])
  return { outDir, stdout }
}

test('UPDATE_AVAILABLE renders issue title and body with the manual update command', async () => {
  const { outDir } = await render(updateAvailableReport)
  try {
    const title = await readFile(join(outDir, 'harness-issue-title.txt'), 'utf8')
    assert.match(title, /Harness update available \[master\]: 0\.1\.0-rc\.8 \(aaaabbbbcccc\)/)
    const body = await readFile(join(outDir, 'harness-issue-body.md'), 'utf8')
    assert.match(body, /Candidate on `master` \| 0\.1\.0-rc\.8/)
    assert.match(body, /--remote origin --ref master/)
    assert.match(body, /--apply --report \.\/artifacts\/harness-update\.json/)
    assert.match(body, /node scripts\/update-harness-pin\.mjs/)
    assert.match(body, /--pin "\$CURRENT_STACK\/config\/harness-pin\.json"/)
    assert.ok(body.includes('CURRENT_STACK=".'))
    assert.ok(body.includes('HARNESS_CHECKOUT="../deepseek-harness"'))
    assert.doesNotMatch(body, /examples\/reference/)
    assert.match(body, /workflow never applies/)
    assert.match(body, /does not publish an App/)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test('UPDATE_AVAILABLE renders maintainer-provided checkout paths', async () => {
  const { outDir } = await render(updateAvailableReport, [
    '--stack-root', '/Users/maintainer/dsh-stack',
    '--harness-root', '/Users/maintainer/deepseek-harness',
  ])
  try {
    const body = await readFile(join(outDir, 'harness-issue-body.md'), 'utf8')
    assert.match(body, /CURRENT_STACK="\/Users\/maintainer\/dsh-stack"/)
    assert.match(body, /HARNESS_CHECKOUT="\/Users\/maintainer\/deepseek-harness"/)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test('UP_TO_DATE renders only the auto-close comment', async () => {
  const { outDir } = await render(upToDateReport)
  try {
    const files = await readdir(outDir)
    assert.deepEqual(files.filter(name => name.startsWith('harness-issue-')), ['harness-issue-close-comment.txt'])
    const comment = await readFile(join(outDir, 'harness-issue-close-comment.txt'), 'utf8')
    assert.match(comment, /Up to date again: 0\.1\.0-rc\.7/)
    assert.match(comment, /does not certify or publish/)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test('UNAVAILABLE renders no issue artifacts and reports the diagnostic in the summary', async () => {
  const report = {
    ...updateAvailableReport,
    status: 'UNAVAILABLE',
    candidate: undefined,
    diagnostic: { code: 'UPSTREAM_UPDATE_UNAVAILABLE', stage: 'UPSTREAM_VERIFY', message: 'fetch failed' },
  }
  const { outDir, stdout } = await render(report, ['--summary'])
  try {
    const files = await readdir(outDir)
    assert.deepEqual(files.filter(name => name.startsWith('harness-issue-')), [])
    assert.match(stdout, /Harness Update Check: `UNAVAILABLE`/)
    assert.match(stdout, /UPSTREAM_UPDATE_UNAVAILABLE: fetch failed/)
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test('unknown harness-check statuses are rejected', async () => {
  await assert.rejects(render({ status: 'BOGUS' }), /Unsupported harness-check status/)
})
