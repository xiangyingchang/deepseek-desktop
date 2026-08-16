import { isDeepStrictEqual } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DshStackError, diagnostic } from './errors.ts'
import type { Stage, VerificationReceipt, VerificationRun } from './types.ts'

interface JsonObject {
  [key: string]: unknown
}

function objectValue(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function stringValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function stagePassed(stages: unknown, stage: Stage): boolean {
  return Array.isArray(stages) && stages.some(value => {
    const item = objectValue(value)
    return item?.stage === stage && item.status === 'passed'
  })
}

/** Validate the minimum complete proof emitted by the real Runtime Verify. */
export function isRuntimePassReceipt(value: unknown): value is VerificationReceipt {
  const receipt = objectValue(value)
  const stack = objectValue(receipt?.stack)
  const verification = objectValue(receipt?.verification)
  const environment = objectValue(receipt?.environment)
  const harness = objectValue(receipt?.harness)
  const profile = objectValue(receipt?.profile)
  const externalServices = objectValue(receipt?.externalServices)
  if (receipt === undefined || stack === undefined || verification === undefined || environment === undefined
    || harness === undefined || profile === undefined || externalServices === undefined) return false
  if (receipt.schemaVersion !== 1 || stack.id === undefined || stack.version === undefined || stack.integrity === undefined
    || !stringValue(stack.id) || !stringValue(stack.version) || !stringValue(stack.integrity)) return false
  if (verification.level !== 'runtime' || verification.result !== 'pass' || verification.cacheUsed !== false
    || !stringValue(verification.startedAt) || !stringValue(verification.finishedAt)) return false
  if (!stringValue(environment.os) || !stringValue(environment.arch) || !stringValue(environment.node)
    || !stringValue(environment.pnpm) || environment.clean !== true) return false
  if (!stringValue(harness.version) || (harness.mode !== 'source' && harness.mode !== 'installed')) return false
  if (!stringValue(profile.name) || !Array.isArray(profile.generatedFiles)) return false
  if (externalServices.llm !== false || !Array.isArray(externalServices.network)) return false
  if (receipt.thirdPartyCodeExecuted !== true || !Array.isArray(receipt.stages)
    || !Array.isArray(receipt.checks) || !Array.isArray(receipt.diagnostics) || receipt.diagnostics.length !== 0) return false
  return ['STATIC_VERIFY', 'MATERIALIZE', 'BOOT', 'ACTIVATE', 'CORE_TEST'].every(stage => stagePassed(receipt.stages, stage as Stage))
}

export function requireRuntimePassReceipt(
  value: unknown,
  expected: { id: string; version: string; integrity: string },
  stage: Stage,
): VerificationReceipt {
  if (!isRuntimePassReceipt(value)
    || value.stack.id !== expected.id
    || value.stack.version !== expected.version
    || value.stack.integrity !== expected.integrity) {
    throw new DshStackError(diagnostic('VERIFICATION_INCOMPLETE', stage, 'The operation requires a complete Runtime PASS produced for the current Stack', {
      action: 'Run the standard Verify command immediately before this operation; a hand-edited or stale Receipt is not accepted.',
    }))
  }
  return value
}

/** Verify that the Receipt returned by this Verify run is exactly the file that will be distributed. */
export async function readAndMatchVerifiedReceipt(
  root: string,
  run: VerificationRun,
  expected: { id: string; version: string; integrity: string },
  stage: Stage,
): Promise<VerificationReceipt> {
  if (run.exitCode !== 0) {
    throw new DshStackError(run.receipt.diagnostics[0] ?? diagnostic('VERIFICATION_INCOMPLETE', stage, 'Runtime Verify did not PASS', {
      action: 'Resolve the Verify diagnostics before continuing.',
    }), run.exitCode === 2 ? 2 : 1)
  }
  const receipt = requireRuntimePassReceipt(run.receipt, expected, stage)
  let onDisk: unknown
  try {
    onDisk = JSON.parse(await readFile(join(root, 'verification.receipt.json'), 'utf8'))
  } catch (error) {
    throw new DshStackError(diagnostic('VERIFICATION_INCOMPLETE', stage, `The current Verification Receipt cannot be read: ${String(error)}`, {
      action: 'Run the standard Verify command again and do not edit its output before continuing.',
    }))
  }
  if (!isDeepStrictEqual(onDisk, receipt)) {
    throw new DshStackError(diagnostic('VERIFICATION_INCOMPLETE', stage, 'The on-disk Verification Receipt changed after Verify', {
      action: 'Do not edit verification.receipt.json; rerun Verify and retry the operation.',
    }))
  }
  return receipt
}
