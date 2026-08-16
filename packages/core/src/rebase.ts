import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { DshStackError, diagnostic } from './errors.ts'
import { portableRelativePath } from './paths.ts'
import { readSafeYaml, writeYaml } from './yaml.ts'
import { readStackManifest, verifyIntegrity, writeIntegrity } from './integrity.ts'
import { distributionFromStack, writeDistributionManifest } from './distribution.ts'
import type { Diagnostic } from './types.ts'

const MISSING = Symbol('missing')
type Missing = typeof MISSING
type Structured = null | boolean | number | string | Structured[] | { [key: string]: Structured }
type MergeValue = Structured | Missing

const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.dsh',
  'node_modules',
  'cache',
  'caches',
  'coverage',
  'dist',
  'build',
  'tmp',
  'sessions',
  'session',
  'logs',
])

const EXCLUDED_FILES = new Set([
  '.DS_Store',
  '.env',
  '.env.local',
  '.env.production',
  'credentials.yaml',
  '.credentials.yaml',
  'session.json',
  'history.json',
])

interface ProfileFile { bytes: Buffer }

interface FileSet {
  files: Map<string, ProfileFile>
  excluded: string[]
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sameBytes(a: Buffer | undefined, b: Buffer | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return hash(a) === hash(b)
}

function same(a: MergeValue, b: MergeValue): boolean {
  if (a === MISSING || b === MISSING) return a === b
  return isDeepStrictEqual(a, b)
}

function objectValue(value: MergeValue): Record<string, MergeValue> | undefined {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, MergeValue>
    : undefined
}

function stringArray(value: MergeValue): string[] | undefined {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return undefined
  return value as string[]
}

function keyedArray(value: MergeValue): Array<{ key: string; value: Record<string, MergeValue> }> | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: Array<{ key: string; value: Record<string, MergeValue> }> = []
  for (const item of value) {
    const object = objectValue(item)
    const key = object?.id ?? object?.name
    if (object === undefined || typeof key !== 'string' || key.length === 0) return undefined
    rows.push({ key, value: object })
  }
  return rows
}

interface MergeSuccess { value: MergeValue; conflicts: [] }
interface MergeConflict { value: Missing; conflicts: string[] }
type MergeResult = MergeSuccess | MergeConflict

function conflict(path: string, reason: string): MergeConflict {
  return { value: MISSING, conflicts: [`${path}: ${reason}`] }
}

function mergeStringArray(base: string[], user: string[], next: string[], path: string): MergeResult {
  const baseSet = new Set(base)
  const userSet = new Set(user)
  const nextSet = new Set(next)
  const userAdded = user.filter(item => !baseSet.has(item))
  const userRemoved = base.filter(item => !userSet.has(item))
  const nextAdded = next.filter(item => !baseSet.has(item))
  const nextRemoved = base.filter(item => !nextSet.has(item))
  const conflictingRemoval = userRemoved.find(item => nextAdded.includes(item))
  if (conflictingRemoval !== undefined) return conflict(path, `user removed ${JSON.stringify(conflictingRemoval)} while the new Base added it`)
  const conflictingAddition = userAdded.find(item => nextRemoved.includes(item))
  if (conflictingAddition !== undefined) return conflict(path, `user added ${JSON.stringify(conflictingAddition)} while the new Base removed it`)
  // Order is meaningful for dsh.profile.bundles. If both sides reordered the
  // same base entries differently, choosing one would guess user intent.
  const baseOrder = JSON.stringify(base)
  if (JSON.stringify(user) !== baseOrder && JSON.stringify(next) !== baseOrder && JSON.stringify(user) !== JSON.stringify(next)
    && userSet.size === baseSet.size && nextSet.size === baseSet.size) {
    return conflict(path, 'user and new Base both changed the order of the same entries')
  }
  const resultSet = new Set([...next, ...user])
  for (const item of [...userRemoved, ...nextRemoved]) resultSet.delete(item)
  const output: string[] = []
  for (const item of [...next, ...user, ...base]) if (resultSet.has(item) && !output.includes(item)) output.push(item)
  return { value: output, conflicts: [] }
}

function mergeKeyedArray(base: Array<{ key: string; value: Record<string, MergeValue> }>, user: Array<{ key: string; value: Record<string, MergeValue> }>, next: Array<{ key: string; value: Record<string, MergeValue> }>, path: string): MergeResult {
  const baseMap = new Map(base.map(row => [row.key, row.value]))
  const userMap = new Map(user.map(row => [row.key, row.value]))
  const nextMap = new Map(next.map(row => [row.key, row.value]))
  const keys = [...new Set([...base.map(row => row.key), ...user.map(row => row.key), ...next.map(row => row.key)])]
  const outputMap = new Map<string, Record<string, MergeValue>>()
  for (const key of keys) {
    const result = mergeValue(
      (baseMap.get(key) ?? MISSING) as unknown as MergeValue,
      (userMap.get(key) ?? MISSING) as unknown as MergeValue,
      (nextMap.get(key) ?? MISSING) as unknown as MergeValue,
      `${path}[${key}]`,
    )
    if (result.conflicts.length > 0) return result
    if (result.value !== MISSING) outputMap.set(key, result.value as Record<string, MergeValue>)
  }
  const output: Record<string, MergeValue>[] = []
  for (const key of [...next.map(row => row.key), ...user.map(row => row.key), ...base.map(row => row.key)]) {
    const value = outputMap.get(key)
    if (value !== undefined && !output.some(row => row === value)) output.push(value)
  }
  return { value: output as unknown as Structured[], conflicts: [] }
}

function mergeObject(base: Record<string, MergeValue> | undefined, user: Record<string, MergeValue>, next: Record<string, MergeValue>, path: string): MergeResult {
  const output: Record<string, Structured> = {}
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(user), ...Object.keys(next)])
  for (const key of keys) {
    const baseHas = base !== undefined && Object.prototype.hasOwnProperty.call(base, key)
    const userHas = Object.prototype.hasOwnProperty.call(user, key)
    const nextHas = Object.prototype.hasOwnProperty.call(next, key)
    const baseValue = baseHas ? base![key]! : MISSING
    const userValue = userHas ? user[key]! : MISSING
    const nextValue = nextHas ? next[key]! : MISSING
    if (!userHas && !nextHas) continue
    if (!userHas && baseHas && !same(nextValue, baseValue)) return conflict(`${path}.${key}`, 'user deleted a value changed by the new Base')
    if (!nextHas && baseHas && !same(userValue, baseValue)) return conflict(`${path}.${key}`, 'new Base deleted a value changed by the user')
    const result = mergeValue(baseValue, userValue, nextValue, `${path}.${key}`)
    if (result.conflicts.length > 0) return result
    if (result.value !== MISSING) output[key] = result.value as Structured
  }
  return { value: output, conflicts: [] }
}

function mergeValue(base: MergeValue, user: MergeValue, next: MergeValue, path: string): MergeResult {
  if (same(user, base)) return { value: next, conflicts: [] }
  if (same(next, base)) return { value: user, conflicts: [] }
  if (same(user, next)) return { value: user, conflicts: [] }
  const userObject = objectValue(user)
  const nextObject = objectValue(next)
  if (userObject !== undefined && nextObject !== undefined) return mergeObject(objectValue(base), userObject, nextObject, path)
  const userStrings = stringArray(user)
  const nextStrings = stringArray(next)
  const baseStrings = stringArray(base)
  if (baseStrings !== undefined && userStrings !== undefined && nextStrings !== undefined) return mergeStringArray(baseStrings, userStrings, nextStrings, path)
  const userRows = keyedArray(user)
  const nextRows = keyedArray(next)
  const baseRows = keyedArray(base)
  if (baseRows !== undefined && userRows !== undefined && nextRows !== undefined) return mergeKeyedArray(baseRows, userRows, nextRows, path)
  return conflict(path, 'both user and new Base changed the same value')
}

function shouldExclude(relativePath: string): boolean {
  const pieces = relativePath.split('/')
  return pieces.some(piece => EXCLUDED_SEGMENTS.has(piece)) || EXCLUDED_FILES.has(basename(relativePath))
}

async function collectFiles(root: string, current = root, files = new Map<string, ProfileFile>(), excluded: string[] = []): Promise<FileSet> {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { files, excluded }
    throw error
  }
  for (const entry of entries) {
    const full = join(current, entry.name)
    const relativePath = portableRelativePath(relative(root, full))
    if (shouldExclude(relativePath)) {
      excluded.push(relativePath)
      continue
    }
    if (entry.isDirectory()) await collectFiles(root, full, files, excluded)
    else if (entry.isFile()) files.set(relativePath, { bytes: await readFile(full) })
  }
  return { files, excluded }
}

function parseStructured(path: string, bytes: Buffer): Structured | undefined {
  try {
    const text = bytes.toString('utf8')
    if (path.endsWith('.json')) return JSON.parse(text) as Structured
    if (path.endsWith('.yaml') || path.endsWith('.yml')) {
      // This uses the safe JSON schema; !!js patches are intentionally not
      // evaluated. Such a file becomes a conflict if both sides changed it.
      return undefined
    }
  } catch {
    return undefined
  }
  return undefined
}

async function parseYaml(bytes: Buffer): Promise<Structured | undefined> {
  const temp = join('/tmp', `dsh-stack-rebase-${process.pid}-${Math.random().toString(16).slice(2)}.yaml`)
  try {
    await writeFile(temp, bytes)
    return await readSafeYaml(temp) as Structured
  } catch {
    return undefined
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

async function parseForMerge(path: string, bytes: Buffer): Promise<Structured | undefined> {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return parseYaml(bytes)
  return parseStructured(path, bytes)
}

function serializeStructured(path: string, value: Structured): Buffer {
  const text = path.endsWith('.json') ? JSON.stringify(value, null, 2) + '\n' : writeYaml(value)
  return Buffer.from(text, 'utf8')
}

export interface ProfileDelta {
  added: string[]
  removed: string[]
  modified: string[]
  excluded: string[]
}

export interface ProfileDriftReport {
  status: 'UNCHANGED' | 'MODIFIED'
  delta: ProfileDelta
  base: { path: string; fileCount: number }
  current: { path: string; fileCount: number }
}

export async function detectProfileDrift(baseProfile: string, currentProfile: string): Promise<ProfileDriftReport> {
  const [base, current] = await Promise.all([collectFiles(baseProfile), collectFiles(currentProfile)])
  const added: string[] = []
  const removed: string[] = []
  const modified: string[] = []
  const paths = [...new Set([...base.files.keys(), ...current.files.keys()])].sort()
  for (const path of paths) {
    const before = base.files.get(path)?.bytes
    const after = current.files.get(path)?.bytes
    if (before === undefined && after !== undefined) added.push(path)
    else if (before !== undefined && after === undefined) removed.push(path)
    else if (before !== undefined && after !== undefined && hash(before) !== hash(after)) modified.push(path)
  }
  return {
    status: added.length + removed.length + modified.length === 0 ? 'UNCHANGED' : 'MODIFIED',
    delta: { added, removed, modified, excluded: [...new Set([...base.excluded, ...current.excluded])].sort() },
    base: { path: resolve(baseProfile), fileCount: base.files.size },
    current: { path: resolve(currentProfile), fileCount: current.files.size },
  }
}

export interface RebaseConflict {
  path: string
  reason: string
}

export interface RebaseReport {
  status: 'PASS' | 'UPDATE_REBASE_CONFLICT'
  oldBase: string
  current: string
  newBase: string
  output?: string
  delta: ProfileDelta
  conflicts: RebaseConflict[]
  filesWritten: string[]
}

async function ensureEmptyOutput(path: string): Promise<void> {
  try {
    const entries = await readdir(path)
    if (entries.length > 0) throw new Error(`output directory is not empty: ${path}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path, { recursive: true })
  }
}

/**
 * Three-way merge of Profile-owned inputs. It never invokes Harness or pnpm;
 * the result is only a candidate standard Profile for the shared verifier.
 */
export async function rebaseProfiles(options: {
  oldBaseProfile: string
  currentProfile: string
  newBaseProfile: string
  outputProfile?: string
}): Promise<RebaseReport> {
  const [oldBase, current, nextBase] = await Promise.all([
    collectFiles(options.oldBaseProfile),
    collectFiles(options.currentProfile),
    collectFiles(options.newBaseProfile),
  ])
  const delta = await detectProfileDrift(options.oldBaseProfile, options.currentProfile).then(result => result.delta)
  const paths = [...new Set([...oldBase.files.keys(), ...current.files.keys(), ...nextBase.files.keys()])].sort()
  const merged = new Map<string, Buffer>()
  const conflicts: RebaseConflict[] = []
  for (const path of paths) {
    const baseBytes = oldBase.files.get(path)?.bytes
    const userBytes = current.files.get(path)?.bytes
    const nextBytes = nextBase.files.get(path)?.bytes
    const base = baseBytes === undefined ? MISSING : baseBytes as unknown as MergeValue
    const user = userBytes === undefined ? MISSING : userBytes as unknown as MergeValue
    const next = nextBytes === undefined ? MISSING : nextBytes as unknown as MergeValue
    let result: MergeResult
    if (sameBytes(userBytes, baseBytes)) result = { value: next, conflicts: [] }
    else if (sameBytes(nextBytes, baseBytes)) result = { value: user, conflicts: [] }
    else if (sameBytes(userBytes, nextBytes)) result = { value: user, conflicts: [] }
    else {
      const [parsedBase, parsedUser, parsedNext] = await Promise.all([
        baseBytes === undefined ? undefined : parseForMerge(path, baseBytes),
        userBytes === undefined ? undefined : parseForMerge(path, userBytes),
        nextBytes === undefined ? undefined : parseForMerge(path, nextBytes),
      ])
      if (parsedBase !== undefined && parsedUser !== undefined && parsedNext !== undefined) {
        result = mergeValue(parsedBase, parsedUser, parsedNext, path)
        if (result.conflicts.length === 0 && result.value !== MISSING) merged.set(path, serializeStructured(path, result.value as Structured))
      } else result = conflict(path, 'both user and new Base changed a non-mergeable file')
    }
    if (result.conflicts.length > 0) {
      conflicts.push(...result.conflicts.map(value => ({ path, reason: value })))
      continue
    }
    if (result.value !== MISSING && !merged.has(path)) merged.set(path, result.value as unknown as Buffer)
  }
  const report: RebaseReport = {
    status: conflicts.length === 0 ? 'PASS' : 'UPDATE_REBASE_CONFLICT',
    oldBase: resolve(options.oldBaseProfile),
    current: resolve(options.currentProfile),
    newBase: resolve(options.newBaseProfile),
    ...(options.outputProfile === undefined ? {} : { output: resolve(options.outputProfile) }),
    delta,
    conflicts,
    filesWritten: [...merged.keys()].sort(),
  }
  if (conflicts.length > 0 || options.outputProfile === undefined) return report
  await ensureEmptyOutput(options.outputProfile)
  for (const [path, bytes] of merged) {
    const target = join(options.outputProfile, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  return report
}

export interface AtomicSwitchResult {
  activePath: string
  backupPath?: string
}

function profileRoot(root: string): string {
  return resolve(root, 'profile')
}

async function pathIsDirectory(path: string): Promise<boolean> {
  return stat(path).then(result => result.isDirectory()).catch(() => false)
}

/** Accept either a Stack root or a bare standard Harness Profile directory. */
export async function resolveProfileInput(root: string): Promise<string> {
  return await pathIsDirectory(join(root, 'profile')) ? profileRoot(root) : resolve(root)
}

export interface RebaseStackResult {
  report: RebaseReport
  candidateStack?: string
}

/** Build a candidate Stack from three Stack/Profile roots without switching it. */
export async function rebaseStack(options: {
  oldBaseStack: string
  currentDerivedStack: string
  newBaseStack: string
  outputStack: string
}): Promise<RebaseStackResult> {
  const oldIntegrity = await verifyIntegrity(options.oldBaseStack)
  if (oldIntegrity.diagnostics.length > 0 || oldIntegrity.manifest === undefined) throw new DshStackError(oldIntegrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'REBASE', 'Old Base Stack integrity is invalid', {
    action: 'Use the immutable Old Base that was recorded for the Derived Profile.',
  }))
  const oldBaseProfile = await resolveProfileInput(options.oldBaseStack)
  const currentProfile = await resolveProfileInput(options.currentDerivedStack)
  const newBaseProfile = await resolveProfileInput(options.newBaseStack)
  const stagingProfile = `${resolve(options.outputStack)}.profile-staging-${process.pid}-${Date.now()}`
  const report = await rebaseProfiles({ oldBaseProfile, currentProfile, newBaseProfile, outputProfile: stagingProfile })
  if (report.status !== 'PASS') {
    await rm(stagingProfile, { recursive: true, force: true })
    return { report }
  }
  try {
    await stat(options.outputStack)
    throw new DshStackError(diagnostic('INVALID_ARGUMENT', 'REBASE', `Candidate Stack output already exists: ${options.outputStack}`, {
      action: 'Choose a new staging path; Rebase never overwrites a candidate.',
    }), 3)
  } catch (error) {
    if (error instanceof DshStackError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await cp(resolve(options.newBaseStack), resolve(options.outputStack), { recursive: true, dereference: true })
  await rm(join(options.outputStack, 'profile'), { recursive: true, force: true })
  await rename(stagingProfile, join(options.outputStack, 'profile'))
  await rm(join(options.outputStack, 'verification.receipt.json'), { force: true })
  await rm(join(options.outputStack, 'stack.integrity.json'), { force: true })
  const nextStack = await readStackManifest(options.outputStack)
  const nextIntegrity = await verifyIntegrity(options.newBaseStack)
  if (nextIntegrity.diagnostics.length > 0 || nextIntegrity.manifest === undefined) {
    await rm(options.outputStack, { recursive: true, force: true })
    throw new DshStackError(nextIntegrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'REBASE', 'New Base Stack integrity is invalid', {
      action: 'Verify the immutable New Base before attempting Distribution Rebase.',
    }))
  }
  const base = nextIntegrity.manifest === undefined ? undefined : {
    id: nextStack.id,
    version: nextStack.version,
    integrity: nextIntegrity.manifest.artifactHash,
  }
  await writeDistributionManifest(options.outputStack, distributionFromStack(nextStack, {
    kind: 'derived',
    channel: 'working',
    base,
  }))
  await writeIntegrity(options.outputStack)
  return { report: { ...report, output: resolve(options.outputStack) }, candidateStack: resolve(options.outputStack) }
}

/** Verify a candidate through the caller's real verifier before switching it. */
export async function verifyThenAtomicSwitch(options: {
  candidateProfile: string
  activeProfile: string
  verify: () => Promise<{ result: 'pass' | 'fail' | 'unsupported' | 'incomplete'; diagnostics?: readonly Diagnostic[] }>
}): Promise<AtomicSwitchResult> {
  const verification = await options.verify()
  if (verification.result !== 'pass') {
    throw new DshStackError(diagnostic('VERIFICATION_INCOMPLETE', 'SWITCH', `Candidate verification returned ${verification.result.toUpperCase()}; Active Profile was not changed`, {
      action: 'Keep the current environment and resolve the candidate diagnostics before retrying the update.',
      details: { diagnostics: verification.diagnostics?.length ?? 0 },
    }))
  }
  return atomicSwitchProfile(options.candidateProfile, options.activeProfile)
}

/** Switch a verified candidate directory without destroying the old profile. */
export async function atomicSwitchProfile(candidatePath: string, activePath: string): Promise<AtomicSwitchResult> {
  const candidate = resolve(candidatePath)
  const active = resolve(activePath)
  if (candidate === active || active.startsWith(candidate + '/') || candidate.startsWith(active + '/')) throw new DshStackError(diagnostic('ATOMIC_SWITCH_FAILED', 'SWITCH', 'Candidate and active Profile paths overlap', {
    component: active,
    action: 'Use separate staging and active directories on the same filesystem.',
  }))
  await stat(candidate).catch(() => { throw new DshStackError(diagnostic('ATOMIC_SWITCH_FAILED', 'SWITCH', `Candidate Profile does not exist: ${candidate}`, { action: 'Rebase and verify a candidate before switching.' })) })
  await mkdir(dirname(active), { recursive: true })
  const backup = `${active}.previous`
  let movedOld = false
  try {
    await rm(backup, { recursive: true, force: true })
    try {
      await rename(active, backup)
      movedOld = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(candidate, active)
    return { activePath: active, ...(movedOld ? { backupPath: backup } : {}) }
  } catch (error) {
    await rm(active, { recursive: true, force: true }).catch(() => {})
    if (movedOld) await rename(backup, active).catch(() => {})
    throw new DshStackError(diagnostic('ATOMIC_SWITCH_FAILED', 'SWITCH', `Unable to atomically activate candidate: ${String(error)}`, {
      component: active,
      action: 'The previous Profile was restored when possible; inspect the staging directory and retry.',
    }))
  }
}

export async function writeRebaseReport(path: string, report: RebaseReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8')
}

export function rebaseConflictDiagnostic(report: RebaseReport): Diagnostic {
  return diagnostic('UPDATE_REBASE_CONFLICT', 'REBASE', `Distribution Rebase found ${report.conflicts.length} conflict(s)`, {
    action: 'Review the listed Profile-owned conflicts and choose a new base or resolve them explicitly before retrying.',
    details: { conflicts: report.conflicts.length, userChanges: report.delta.added.length + report.delta.removed.length + report.delta.modified.length },
  })
}
