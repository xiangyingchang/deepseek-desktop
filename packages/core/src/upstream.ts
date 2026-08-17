import { execFile as execFileCallback } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { DshStackError, diagnostic } from './errors.ts'
import { readStackManifest, verifyIntegrity, writeIntegrity } from './integrity.ts'
import { asYamlObject, readSafeYaml, writeYaml } from './yaml.ts'
import { SourceHarnessAdapter } from './source-adapter.ts'
import { verifyStack, type VerifyResult } from './verify.ts'

const execFile = promisify(execFileCallback)
const GIT_MAX_BUFFER = 1024 * 1024

export interface HarnessUpgradeCandidate {
  root: string
  version: string
  commit?: string
  dirty?: boolean
  observedAt: string
}

export interface HarnessUpdateCheck {
  status: 'UP_TO_DATE' | 'UPDATE_AVAILABLE' | 'UNAVAILABLE'
  harnessRoot: string
  remote: string
  ref: string
  current: {
    version: string
    commit?: string
    dirty: boolean
  }
  candidate?: {
    version: string
    commit: string
    ref: string
  }
  diagnostic?: ReturnType<typeof diagnostic>
  observedAt: string
}

export interface HarnessSyncResult {
  status: 'UP_TO_DATE' | 'SYNCED'
  check: HarnessUpdateCheck
  candidate?: HarnessUpgradeVerification
  applied?: {
    version: string
    commit: string
  }
}

async function gitOutput(root: string, args: readonly string[]): Promise<string> {
  const result = await execFile('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
  })
  return result.stdout.trim()
}

function branchRefs(ref: string): string[] {
  if (ref.startsWith('refs/')) return [ref]
  return [`refs/heads/${ref}`, `refs/tags/${ref}`]
}

async function resolveRemoteRef(root: string, remote: string, ref: string): Promise<{ ref: string; commit: string } | undefined> {
  for (const candidateRef of branchRefs(ref)) {
    try {
      const output = await gitOutput(root, ['ls-remote', '--refs', remote, candidateRef])
      const line = output.split(/\r?\n/u).find(item => item.trim().length > 0)
      const match = line?.trim().match(/^([0-9a-f]{40})\s+(.+)$/u)
      if (match !== null && match !== undefined) return { commit: match[1]!, ref: match[2]! }
    } catch {
      // The caller receives a single sanitized UNAVAILABLE diagnostic.
    }
  }
  return undefined
}

async function packageVersionAtRevision(root: string, revision: string): Promise<string> {
  try {
    const raw = await gitOutput(root, ['show', `${revision}:package.json`])
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { version?: unknown }).version === 'string') return (parsed as { version: string }).version
  } catch {
    // The version is diagnostic context; the commit remains the binding identity.
  }
  return 'unknown'
}

function updateUnavailable(root: string, remote: string, ref: string, current: HarnessUpdateCheck['current'], message: string): HarnessUpdateCheck {
  return {
    status: 'UNAVAILABLE',
    harnessRoot: root,
    remote,
    ref,
    current,
    diagnostic: diagnostic('UPSTREAM_UPDATE_UNAVAILABLE', 'UPSTREAM_VERIFY', message, {
      action: 'Check the Harness remote and ref, then retry without changing the active Stack.',
    }),
    observedAt: new Date().toISOString(),
  }
}

/** Check the configured official Harness ref without changing the working tree. */
export async function checkHarnessUpdate(options: {
  harnessRoot: string
  remote?: string
  ref?: string
  cwd?: string
}): Promise<HarnessUpdateCheck> {
  const root = resolve(options.harnessRoot)
  const remote = options.remote ?? 'origin'
  const ref = options.ref ?? 'master'
  let installation: Awaited<ReturnType<SourceHarnessAdapter['detectInstallation']>>
  try {
    installation = await new SourceHarnessAdapter().detectInstallation({ harnessRoot: root, cwd: options.cwd })
  } catch {
    return updateUnavailable(root, remote, ref, { version: 'unknown', dirty: false }, 'The Harness source checkout could not be inspected.')
  }
  const current = {
    version: installation.version,
    ...(installation.gitCommit === undefined ? {} : { commit: installation.gitCommit }),
    dirty: installation.gitDirty === true,
  }
  const remoteRef = await resolveRemoteRef(root, remote, ref)
  if (remoteRef === undefined) return updateUnavailable(root, remote, ref, current, `Unable to resolve Harness remote ${remote} at ${ref}.`)
  try {
    await gitOutput(root, ['fetch', '--no-tags', '--quiet', remote, remoteRef.ref])
    const candidateVersion = await packageVersionAtRevision(root, remoteRef.commit)
    return {
      status: current.commit === remoteRef.commit ? 'UP_TO_DATE' : 'UPDATE_AVAILABLE',
      harnessRoot: root,
      remote,
      ref,
      current,
      candidate: { version: candidateVersion, commit: remoteRef.commit, ref: remoteRef.ref },
      observedAt: new Date().toISOString(),
    }
  } catch {
    return updateUnavailable(root, remote, ref, current, `Harness remote ${remote} could not be fetched at ${ref}.`)
  }
}

async function installHarnessDependencies(root: string): Promise<void> {
  const environment: NodeJS.ProcessEnv = { ...process.env, DSH_TELEMETRY_DISABLED: '1' }
  delete environment.DEEPSEEK_API_KEY
  try {
    await execFile('pnpm', ['install', '--frozen-lockfile'], {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
    })
  } catch {
    throw new DshStackError(diagnostic('UPSTREAM_SYNC_FAILED', 'UPSTREAM_VERIFY', 'The official Harness dependency install failed for the candidate source.', {
      action: 'Keep the current Harness source active, inspect the pnpm install diagnostics, and retry the candidate update.',
    }))
  }
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: { build?: unknown } }
    if (typeof manifest.scripts?.build === 'string' && manifest.scripts.build.trim().length > 0) {
      await execFile('pnpm', ['run', 'build'], {
        cwd: root,
        env: environment,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER,
      })
    }
  } catch {
    throw new DshStackError(diagnostic('UPSTREAM_SYNC_FAILED', 'UPSTREAM_VERIFY', 'The official Harness build step failed for the candidate source.', {
      action: 'Keep the current Harness source active, inspect the official build diagnostics, and retry the candidate update.',
    }))
  }
}

/**
 * Verify a fetched Harness candidate in an isolated worktree, then fast-forward
 * the clean source checkout and let pnpm install its exact lockfile closure.
 * The current Stack is never switched before the candidate Runtime Verify PASS.
 */
export async function syncHarnessUpdate(options: {
  stackRoot: string
  harnessRoot: string
  remote?: string
  ref?: string
  cwd?: string
  dshHome?: string
  host?: string
  port?: number
}): Promise<HarnessSyncResult> {
  const check = await checkHarnessUpdate(options)
  if (check.status === 'UNAVAILABLE') throw new DshStackError(check.diagnostic ?? diagnostic('UPSTREAM_UPDATE_UNAVAILABLE', 'UPSTREAM_VERIFY', 'Harness update check was unavailable', {
    action: 'Check the Harness remote and ref, then retry without changing the active Stack.',
  }))
  if (check.status === 'UP_TO_DATE') return { status: 'UP_TO_DATE', check }
  if (check.current.dirty) throw new DshStackError(diagnostic('UPSTREAM_SOURCE_DIRTY', 'UPSTREAM_VERIFY', 'The Harness source checkout has local changes; update was not applied.', {
    action: 'Commit or stash local Harness changes, then rerun the update check.',
  }))
  const candidate = check.candidate!
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-stack-harness-update-'))
  const candidateRoot = join(temporaryRoot, 'harness')
  let verification: HarnessUpgradeVerification | undefined
  try {
    await gitOutput(check.harnessRoot, ['worktree', 'add', '--detach', candidateRoot, candidate.commit])
    await installHarnessDependencies(candidateRoot)
    verification = await verifyHarnessUpgrade({
      stackRoot: options.stackRoot,
      candidateHarnessRoot: candidateRoot,
      cwd: options.cwd,
      dshHome: options.dshHome,
      host: options.host,
      port: options.port,
    })
    if (verification.receipt.verification.result !== 'pass') throw new DshStackError(diagnostic('UPSTREAM_CANDIDATE_UNVERIFIED', 'UPSTREAM_VERIFY', `Harness candidate ${candidate.version} did not pass Runtime Verify.`, {
      action: 'Keep the current Harness source active and inspect the candidate receipt before retrying.',
    }))
    await gitOutput(check.harnessRoot, ['merge', '--ff-only', candidate.commit])
    await installHarnessDependencies(check.harnessRoot)
    const applied = await new SourceHarnessAdapter().detectInstallation({ harnessRoot: check.harnessRoot, cwd: options.cwd })
    return {
      status: 'SYNCED',
      check,
      candidate: verification,
      applied: { version: applied.version, commit: applied.gitCommit ?? candidate.commit },
    }
  } catch (error) {
    if (error instanceof DshStackError) throw error
    throw new DshStackError(diagnostic('UPSTREAM_SYNC_FAILED', 'UPSTREAM_VERIFY', 'The Harness source could not be synchronized after candidate verification.', {
      action: 'Inspect the source checkout and rerun the update; no Stack or User State was changed.',
    }))
  } finally {
    await gitOutput(check.harnessRoot, ['worktree', 'remove', '--force', candidateRoot]).catch(() => {})
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
  }
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
