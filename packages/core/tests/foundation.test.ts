import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  computeIntegrity,
  detectSecretIndicators,
  profileDirectory,
  redactSecrets,
  readSafeYaml,
  verifyIntegrity,
  writeIntegrity,
} from '../src/index.ts'

test('redacts credential values while preserving the diagnostic key', () => {
  const input = 'DEEPSEEK_API_KEY=sk-1234567890abcdef Authorization: Bearer abcdefghijklmnop'
  const redacted = redactSecrets(input)
  assert.equal(redacted.includes('sk-1234567890abcdef'), false)
  assert.equal(redacted.includes('abcdefghijklmnop'), false)
  assert.equal(redacted.includes('DEEPSEEK_API_KEY'), true)
})

test('detects high-confidence secret values but not bare secret names', () => {
  assert.deepEqual(detectSecretIndicators('cordis.patch.yml', 'DEEPSEEK_API_KEY'), [])
  assert.ok(detectSecretIndicators('.env', 'DEEPSEEK_API_KEY=sk-1234567890abcdef').length > 0)
})

test('rejects profile traversal names', () => {
  assert.throws(() => profileDirectory('/tmp/dsh-home', '../escape'), /invalid profile name/)
  assert.equal(profileDirectory('/tmp/dsh-home', 'web'), '/tmp/dsh-home/profiles/web')
})

test('safe YAML never evaluates JavaScript tags', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-yaml-test-'))
  const path = join(root, 'patch.yml')
  await writeFile(path, 'value: !!js/function >\n  function () { return 1 }\n', 'utf8')
  await assert.rejects(readSafeYaml(path))
  await rm(root, { recursive: true, force: true })
})

test('integrity is deterministic and detects tampering', async () => {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-integrity-test-'))
  await mkdir(join(root, 'profile'), { recursive: true })
  await writeFile(join(root, 'stack.yaml'), 'schemaVersion: 1\n', 'utf8')
  await writeFile(join(root, 'profile', 'package.json'), '{}\n', 'utf8')
  const first = await computeIntegrity(root)
  const written = await writeIntegrity(root)
  assert.deepEqual(written, first)
  assert.deepEqual((await verifyIntegrity(root)).diagnostics, [])
  await writeFile(join(root, 'stack.yaml'), 'schemaVersion: 1\nchanged: true\n', 'utf8')
  assert.equal((await verifyIntegrity(root)).diagnostics[0]?.code, 'STACK_INTEGRITY_ERROR')
  await rm(root, { recursive: true, force: true })
})
