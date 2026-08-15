import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { freezeProfile, verifyStack } from '@dsh-stack/core'

if (process.env.DSH_STACK_REAL_HARNESS !== '1') {
  console.log('reference integration skipped; set DSH_STACK_REAL_HARNESS=1 to run against the real DeepSeek Harness checkout')
} else {
  const root = await mkdtemp(join('/tmp', 'dsh-stack-real-integration-'))
  try {
    const harnessRoot = process.env.DSH_HARNESS_ROOT ?? join(process.cwd(), '..', 'deepseek-harness')
    const dshHome = process.env.DSH_HOME
    const artifact = join(root, 'reference')
    await freezeProfile({ profile: 'web', output: artifact, harnessRoot, dshHome, cwd: process.cwd() })
    const result = await verifyStack({ stackRoot: artifact, harnessRoot, dshHome, cwd: process.cwd() })
    assert.equal(result.exitCode, 0)
    assert.equal(result.receipt.verification.result, 'pass')
    assert.equal(result.receipt.thirdPartyCodeExecuted, true)
    console.log(`reference integration passed: ${result.receipt.stack.integrity}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
