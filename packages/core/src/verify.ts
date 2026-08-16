import { writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DshStackError,
  asDiagnostic,
  diagnostic,
  readStackManifest,
  type Diagnostic,
  type HarnessInstallation,
  type Stage,
  type StageEvent,
  type VerificationCheck,
  type VerificationReceipt,
  type VerificationResult,
  type DistributionManifest,
  type VerificationRun,
} from './index.ts'
import { verifyIntegrity } from './integrity.ts'
import { currentPlatform, SourceHarnessAdapter } from './source-adapter.ts'
import { StackMaterializer, startOfficialWeb, type HarnessProcess } from './materializer.ts'
import { readDistributionManifest } from './distribution.ts'

function now(): string {
  return new Date().toISOString()
}

function addStage(stages: StageEvent[], stage: Stage, status: StageEvent['status'], message?: string): void {
  stages.push({ stage, status, at: now(), ...(message === undefined ? {} : { message }) })
}

function check(name: string, type: string, stage: Stage, result: VerificationCheck['result'], message: string): VerificationCheck {
  return { name, type, stage, result, message }
}

function diagnosticResult(diagnostics: readonly Diagnostic[]): VerificationResult {
  if (diagnostics.some(item => item.code === 'UNSUPPORTED_PLATFORM' || item.code === 'HARNESS_VERSION_UNAVAILABLE' || item.code === 'HARNESS_NOT_FOUND' || item.code === 'LIVE_VERIFICATION_UNSUPPORTED')) return 'unsupported'
  return diagnostics.length === 0 ? 'pass' : 'fail'
}

function receiptFor(options: {
  startedAt: string
  result: VerificationResult
  integrity: string
  id: string
  version: string
  installation?: HarnessInstallation
  profile: string
  stages: StageEvent[]
  checks: VerificationCheck[]
  diagnostics: Diagnostic[]
  generatedFiles?: string[]
  distribution?: DistributionManifest
}): VerificationReceipt {
  const installation = options.installation
  const harness: VerificationReceipt['harness'] = {
    version: installation?.version ?? 'unavailable',
    mode: installation?.mode ?? 'source',
    ...(installation?.gitCommit === undefined ? {} : { commit: installation.gitCommit }),
  }
  return {
    schemaVersion: 1,
    stack: { id: options.id, version: options.version, integrity: options.integrity },
    verification: {
      level: 'runtime',
      result: options.result,
      startedAt: options.startedAt,
      finishedAt: now(),
      cacheUsed: false,
    },
    environment: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      pnpm: installation?.observedPackageManager ?? 'unavailable',
      clean: true,
    },
    harness,
    profile: { name: options.profile, generatedFiles: options.generatedFiles ?? [] },
    ...(options.distribution === undefined ? {} : {
      distribution: {
        kind: options.distribution.kind,
        ...(options.distribution.storageId === undefined ? {} : { storageId: options.distribution.storageId }),
        ...(options.distribution.base === undefined ? {} : { base: options.distribution.base }),
      },
    }),
    thirdPartyCodeExecuted: options.stages.some(stage => stage.stage === 'BOOT' && stage.status !== 'skipped'),
    externalServices: { llm: false, network: ['localhost Web UI readiness'] },
    stages: options.stages,
    checks: options.checks,
    diagnostics: options.diagnostics,
  }
}

async function persistReceipt(root: string, receipt: VerificationReceipt): Promise<string> {
  const path = join(root, 'verification.receipt.json')
  await writeFile(path, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
  return path
}

/** Result returned by Verify, including its stable process exit code. */
export interface VerifyResult extends VerificationRun {
  /** Retained only when the caller requested `keepTemp`; the caller owns cleanup. */
  materializedProfile?: string
  cleanup?: () => Promise<void>
}

/** Verify an exact Stack with static checks followed by the shared materializer and official UI. */
export async function verifyStack(options: {
  stackRoot: string
  harnessRoot?: string
  dshHome?: string
  cwd?: string
  keepTemp?: boolean
  host?: string
  port?: number
}): Promise<VerifyResult> {
  const startedAt = now()
  const stages: StageEvent[] = []
  const checks: VerificationCheck[] = []
  const diagnostics: Diagnostic[] = []
  let manifest
  try {
    addStage(stages, 'STATIC_VERIFY', 'started')
    manifest = await readStackManifest(options.stackRoot)
    checks.push(check('Stack schema', 'static.schema', 'STATIC_VERIFY', 'pass', 'stack.yaml schemaVersion 1 is valid.'))
  } catch (error) {
    const d = diagnostic('STACK_SCHEMA_ERROR', 'STATIC_VERIFY', `Invalid stack.yaml: ${String(error)}`, {
      action: 'Re-freeze the artifact and do not edit stack.yaml by hand.',
    })
    diagnostics.push(d)
    addStage(stages, 'STATIC_VERIFY', 'failed', d.message)
    const receipt = receiptFor({ startedAt, result: 'fail', integrity: 'unavailable', id: 'unknown', version: 'unknown', profile: 'unknown', stages, checks, diagnostics })
    return { receipt, receiptPath: await persistReceipt(options.stackRoot, receipt), exitCode: 1 }
  }

  const integrity = await verifyIntegrity(options.stackRoot)
  diagnostics.push(...integrity.diagnostics)
  checks.push(check('Artifact integrity', 'static.integrity', 'STATIC_VERIFY', integrity.diagnostics.length === 0 ? 'pass' : 'fail', integrity.diagnostics.length === 0 ? 'All hashed Stack files match.' : 'Stack integrity mismatch.'))
  if (integrity.diagnostics.length > 0 || integrity.manifest === undefined) {
    addStage(stages, 'STATIC_VERIFY', 'failed', 'Stack integrity did not pass.')
    const receipt = receiptFor({ startedAt, result: 'fail', integrity: integrity.manifest?.artifactHash ?? 'unavailable', id: manifest.id, version: manifest.version, profile: manifest.harness.profile, stages, checks, diagnostics })
    return { receipt, receiptPath: await persistReceipt(options.stackRoot, receipt), exitCode: 1 }
  }

  let distribution: DistributionManifest | undefined
  try {
    distribution = await readDistributionManifest(options.stackRoot)
    if (distribution !== undefined && (distribution.id !== manifest.id
      || distribution.version !== manifest.version
      || distribution.harness.version !== manifest.harness.version
      || distribution.harness.adapter !== manifest.harness.adapter
      || distribution.harness.profile !== manifest.harness.profile)) {
      throw new Error('distribution metadata does not match stack.yaml identity or Harness pin')
    }
    checks.push(check('Distribution metadata', 'static.distribution', 'STATIC_VERIFY', 'pass', distribution === undefined ? 'Legacy Stack has no distribution metadata.' : `Distribution ${distribution.kind} metadata is valid.`))
  } catch (error) {
    const d = diagnostic('DISTRIBUTION_SCHEMA_ERROR', 'STATIC_VERIFY', `Invalid distribution.yaml: ${String(error)}`, {
      action: 'Recreate lifecycle metadata with the current DSH Stack command; do not edit it into a second Plugin manifest.',
    })
    diagnostics.push(d)
    checks.push(check('Distribution metadata', 'static.distribution', 'STATIC_VERIFY', 'fail', d.message))
    addStage(stages, 'STATIC_VERIFY', 'failed', d.message)
    const receipt = receiptFor({ startedAt, result: 'fail', integrity: integrity.manifest.artifactHash, id: manifest.id, version: manifest.version, profile: manifest.harness.profile, stages, checks, diagnostics })
    return { receipt, receiptPath: await persistReceipt(options.stackRoot, receipt), exitCode: 1 }
  }

  const adapter = new SourceHarnessAdapter()
  let installation: HarnessInstallation
  try {
    installation = await adapter.detectInstallation({ cwd: options.cwd, harnessRoot: options.harnessRoot, dshHome: options.dshHome })
  } catch (error) {
    const d = diagnostic('HARNESS_NOT_FOUND', 'STATIC_VERIFY', String(error), {
      action: 'Pass --harness <DeepSeek Harness checkout> or set DSH_HARNESS_ROOT.',
    })
    diagnostics.push(d)
    checks.push(check('Harness installation', 'static.harness', 'STATIC_VERIFY', 'unsupported', 'No compatible Harness installation was found.'))
    addStage(stages, 'STATIC_VERIFY', 'failed', d.message)
    const receipt = receiptFor({ startedAt, result: 'unsupported', integrity: integrity.manifest.artifactHash, id: manifest.id, version: manifest.version, profile: manifest.harness.profile, stages, checks, diagnostics })
    return { receipt, receiptPath: await persistReceipt(options.stackRoot, receipt), exitCode: 2 }
  }
  if (installation.version !== manifest.harness.version) {
    const d = diagnostic('HARNESS_VERSION_MISMATCH', 'STATIC_VERIFY', `Stack requires Harness ${manifest.harness.version}, found ${installation.version}`, {
      component: 'harness.version',
      action: 'Use the exact Harness checkout/version named by the Stack or freeze again.',
    })
    diagnostics.push(d)
    checks.push(check('Harness version', 'static.harness-version', 'STATIC_VERIFY', 'fail', d.message))
  } else checks.push(check('Harness version', 'static.harness-version', 'STATIC_VERIFY', 'pass', `Harness ${installation.version} matches the Stack pin.`))
  const current = currentPlatform()
  if (!manifest.environment.platform.os.includes(current.os) || !manifest.environment.platform.arch.includes(current.arch)) {
    const d = diagnostic('UNSUPPORTED_PLATFORM', 'STATIC_VERIFY', `Stack supports ${manifest.environment.platform.os.join(',')} ${manifest.environment.platform.arch.join(',')}; current host is ${current.os} ${current.arch}`, {
      action: 'Verify on a declared platform or freeze a platform-specific Stack.',
    })
    diagnostics.push(d)
    checks.push(check('Platform', 'static.platform', 'STATIC_VERIFY', 'unsupported', d.message))
  } else checks.push(check('Platform', 'static.platform', 'STATIC_VERIFY', 'pass', `Platform ${current.os} ${current.arch} is declared.`))
  if (manifest.harness.adapter !== adapter.id) {
    diagnostics.push(diagnostic('HARNESS_VERSION_UNAVAILABLE', 'STATIC_VERIFY', `No adapter for ${manifest.harness.adapter}`, {
      component: 'harness.adapter',
      action: 'Use a compatible DSH Stack CLI or adapter.',
    }))
  }
  if (diagnostics.length > 0) {
    addStage(stages, 'STATIC_VERIFY', 'failed', 'Static verification failed.')
    const result = diagnosticResult(diagnostics)
    const receipt = receiptFor({ startedAt, result, integrity: integrity.manifest.artifactHash, id: manifest.id, version: manifest.version, installation, profile: manifest.harness.profile, stages, checks, diagnostics, distribution })
    return { receipt, receiptPath: await persistReceipt(options.stackRoot, receipt), exitCode: result === 'unsupported' ? 2 : 1 }
  }
  addStage(stages, 'STATIC_VERIFY', 'passed')

  let environment
  let harnessProcess: HarnessProcess | undefined
  try {
    addStage(stages, 'MATERIALIZE', 'started')
    environment = await new StackMaterializer().materialize({ stackRoot: options.stackRoot, stack: manifest, installation })
    addStage(stages, 'MATERIALIZE', 'passed', environment.installRequired ? 'Profile materialized with frozen dependency installation.' : 'Profile materialized; no external Profile dependency install was required.')
    addStage(stages, 'BOOT', 'started')
    harnessProcess = await startOfficialWeb(environment, { host: options.host, port: options.port })
    addStage(stages, 'BOOT', 'passed', `Official Harness Web UI responded at ${harnessProcess.url}.`)
    checks.push(check('Official Harness Web UI responds', 'runtime.health', 'CORE_TEST', 'pass', harnessProcess.url))
    addStage(stages, 'ACTIVATE', 'passed', 'The official Web profile reached its serving state.')
    const generatedRoot = await stat(join(environment.profileDir, 'cordis.yml')).then(() => true).catch(() => false)
    checks.push(check('Profile generated root', 'profile.generated-root', 'ACTIVATE', generatedRoot ? 'pass' : 'fail', 'The official CLI owns cordis.yml generation.'))
    if (!generatedRoot) throw new DshStackError(diagnostic('PROFILE_MATERIALIZATION_FAILED', 'ACTIVATE', 'The official Harness did not generate cordis.yml for the exact materialized Profile', {
      component: environment.profileDir,
      action: 'Verify the exact Profile name and inspect the official Harness activation output; do not accept a default-profile fallback.',
    }))
    addStage(stages, 'CORE_TEST', 'started')
    checks.push(check('No LLM request required', 'runtime.no-live-llm', 'CORE_TEST', 'pass', 'Core verification used localhost UI health only.'))
    addStage(stages, 'CORE_TEST', 'passed')
    await harnessProcess.stop()
    const retainedEnvironment = options.keepTemp === true ? environment : undefined
    if (retainedEnvironment === undefined) await environment.cleanup()
    const receipt = receiptFor({ startedAt, result: 'pass', integrity: integrity.manifest.artifactHash, id: manifest.id, version: manifest.version, installation, profile: manifest.harness.profile, stages, checks, diagnostics, generatedFiles: ['cordis.yml'], distribution })
    return {
      receipt,
      receiptPath: await persistReceipt(options.stackRoot, receipt),
      exitCode: 0,
      ...(retainedEnvironment === undefined ? {} : {
        materializedProfile: retainedEnvironment.profileDir,
        cleanup: retainedEnvironment.cleanup,
      }),
    }
  } catch (error) {
    const d = asDiagnostic(error, stages.at(-1)?.stage ?? 'MATERIALIZE')
    diagnostics.push(d)
    addStage(stages, d.stage, 'failed', d.message)
    if (harnessProcess !== undefined) await harnessProcess.stop().catch(() => {})
    if (environment !== undefined) await environment.cleanup().catch(() => {})
    const result = d.code === 'HARNESS_VERSION_UNAVAILABLE' || d.code === 'UNSUPPORTED_PLATFORM' ? 'unsupported' : 'fail'
    const receipt = receiptFor({ startedAt, result, integrity: integrity.manifest.artifactHash, id: manifest.id, version: manifest.version, installation, profile: manifest.harness.profile, stages, checks, diagnostics, distribution })
    return { receipt, receiptPath: await persistReceipt(options.stackRoot, receipt), exitCode: result === 'unsupported' ? 2 : 1 }
  }
}
