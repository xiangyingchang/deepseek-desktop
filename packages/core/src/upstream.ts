import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DshStackError, diagnostic } from './errors.ts'
import { readStackManifest, verifyIntegrity, writeIntegrity } from './integrity.ts'
import { asYamlObject, readSafeYaml, writeYaml } from './yaml.ts'
import { SourceHarnessAdapter } from './source-adapter.ts'
import { verifyStack, type VerifyResult } from './verify.ts'

export interface HarnessUpgradeCandidate {
  root: string
  version: string
  commit?: string
  dirty?: boolean
  observedAt: string
}

/** Inspect an explicit upstream checkout; no branch is auto-upgraded or published. */
export async function inspectHarnessUpgradeCandidate(options: { harnessRoot: string; cwd?: string }): Promise<HarnessUpgradeCandidate> {
  const installation = await new SourceHarnessAdapter().detectInstallation({ harnessRoot: options.harnessRoot, cwd: options.cwd })
  return {
    root: installation.root,
    version: installation.version,
    ...(installation.gitCommit === undefined ? {} : { commit: installation.gitCommit }),
    ...(installation.gitDirty === undefined ? {} : { dirty: installation.gitDirty }),
    observedAt: new Date().toISOString(),
  }
}

export interface HarnessUpgradeVerification {
  candidate: HarnessUpgradeCandidate
  receipt: VerifyResult['receipt']
  receiptPath: string
  candidateStack: string
}

/**
 * Verify the current exact Stack/Profile against an explicit Harness checkout.
 * The original Stack is never edited; the candidate pin lives in a disposable
 * Stack copy and goes through the ordinary verifier/materializer.
 */
export async function verifyHarnessUpgrade(options: {
  stackRoot: string
  candidateHarnessRoot: string
  cwd?: string
  dshHome?: string
  host?: string
  port?: number
}): Promise<HarnessUpgradeVerification> {
  const candidate = await inspectHarnessUpgradeCandidate({ harnessRoot: options.candidateHarnessRoot, cwd: options.cwd })
  const sourceIntegrity = await verifyIntegrity(options.stackRoot)
  if (sourceIntegrity.diagnostics.length > 0 || sourceIntegrity.manifest === undefined) throw new DshStackError(sourceIntegrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'UPSTREAM_VERIFY', 'Current Stack integrity is invalid', {
    action: 'Verify the current Base/Derived Stack before testing an upstream candidate.',
  }))
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-stack-upgrade-candidate-'))
  const candidateStack = join(tempRoot, 'stack')
  try {
    await cp(options.stackRoot, candidateStack, { recursive: true, dereference: true })
    await rm(join(candidateStack, 'verification.receipt.json'), { force: true })
    await rm(join(candidateStack, 'stack.integrity.json'), { force: true })
    const stack = await readStackManifest(candidateStack)
    stack.harness.version = candidate.version
    await writeFile(join(candidateStack, 'stack.yaml'), writeYaml(stack), 'utf8')
    try {
      const distribution = asYamlObject(await readSafeYaml(join(candidateStack, 'distribution.yaml')), 'distribution.yaml')
      const harness = distribution.harness !== null && typeof distribution.harness === 'object' && !Array.isArray(distribution.harness)
        ? distribution.harness as Record<string, unknown>
        : undefined
      if (harness !== undefined) harness.version = candidate.version
      await writeFile(join(candidateStack, 'distribution.yaml'), writeYaml(distribution), 'utf8')
    } catch {
      // Legacy Stack: stack.yaml remains the sole metadata source.
    }
    await writeIntegrity(candidateStack)
    const verification = await verifyStack({
      stackRoot: candidateStack,
      harnessRoot: candidate.root,
      dshHome: options.dshHome,
      cwd: options.cwd,
      host: options.host,
      port: options.port,
    })
    return { candidate, receipt: verification.receipt, receiptPath: verification.receiptPath, candidateStack }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
