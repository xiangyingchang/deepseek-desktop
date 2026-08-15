import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { verifyStack } from '../src/index.ts'

test('tampering a frozen Stack fails before Harness runtime execution', async () => {
  const source = resolve(process.cwd(), 'examples/reference')
  const root = await mkdtemp(join('/tmp', 'dsh-stack-tampered-'))
  await cp(source, root, { recursive: true })
  const stackPath = join(root, 'stack.yaml')
  await writeFile(stackPath, `${await readFile(stackPath, 'utf8')}# tampered\n`, 'utf8')
  const result = await verifyStack({ stackRoot: root, harnessRoot: '/definitely-not-a-harness' })
  assert.equal(result.exitCode, 1)
  assert.equal(result.receipt.verification.result, 'fail')
  assert.equal(result.receipt.diagnostics[0]?.code, 'STACK_INTEGRITY_ERROR')
  await rm(root, { recursive: true, force: true })
})
