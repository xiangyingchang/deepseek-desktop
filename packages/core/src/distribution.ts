import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { asYamlObject, readSafeYaml, writeYaml } from './yaml.ts'
import type { DistributionManifest, StackManifest } from './types.ts'
import { DshStackError, diagnostic } from './errors.ts'
import { readStackManifest, verifyIntegrity, writeIntegrity } from './integrity.ts'
import { readAndMatchVerifiedReceipt } from './receipt.ts'
import type { VerificationRun } from './types.ts'

const DISTRIBUTION_FILE = 'distribution.yaml'

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

export function stableStorageId(value: unknown, field = 'storageId'): string {
  const text = requiredString(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(text)) throw new Error(`${field} must be a safe stable path component`)
  return text
}

/** Read release metadata without treating it as a second Profile manifest. */
export async function readDistributionManifest(root: string): Promise<DistributionManifest | undefined> {
  let value: unknown
  try {
    value = await readSafeYaml(join(root, DISTRIBUTION_FILE))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const object = asYamlObject(value, DISTRIBUTION_FILE)
  if (object.schemaVersion !== 1) throw new Error(`${DISTRIBUTION_FILE} schemaVersion must be 1`)
  if (object.kind !== 'base' && object.kind !== 'derived' && object.kind !== 'candidate') throw new Error(`${DISTRIBUTION_FILE} kind is invalid`)
  if (object.channel !== 'stable' && object.channel !== 'rc' && object.channel !== 'working') throw new Error(`${DISTRIBUTION_FILE} channel is invalid`)
  requiredString(object.id, `${DISTRIBUTION_FILE} id`)
  requiredString(object.version, `${DISTRIBUTION_FILE} version`)
  if (object.storageId !== undefined) stableStorageId(object.storageId, `${DISTRIBUTION_FILE} storageId`)
  const harness = asYamlObject(object.harness, `${DISTRIBUTION_FILE} harness`)
  requiredString(harness.version, `${DISTRIBUTION_FILE} harness.version`)
  requiredString(harness.adapter, `${DISTRIBUTION_FILE} harness.adapter`)
  requiredString(harness.profile, `${DISTRIBUTION_FILE} harness.profile`)
  const profile = asYamlObject(object.profile, `${DISTRIBUTION_FILE} profile`)
  if (profile.source !== './profile') throw new Error(`${DISTRIBUTION_FILE} profile.source must be ./profile`)
  const release = asYamlObject(object.release, `${DISTRIBUTION_FILE} release`)
  requiredString(release.createdAt, `${DISTRIBUTION_FILE} release.createdAt`)
  if (release.createdBy !== 'dsh-stack') throw new Error(`${DISTRIBUTION_FILE} release.createdBy must be dsh-stack`)
  if (object.base !== undefined) {
    const base = asYamlObject(object.base, `${DISTRIBUTION_FILE} base`)
    requiredString(base.id, `${DISTRIBUTION_FILE} base.id`)
    requiredString(base.version, `${DISTRIBUTION_FILE} base.version`)
    requiredString(base.integrity, `${DISTRIBUTION_FILE} base.integrity`)
  }
  return object as unknown as DistributionManifest
}

export async function writeDistributionManifest(root: string, manifest: DistributionManifest): Promise<string> {
  const path = join(root, DISTRIBUTION_FILE)
  await writeFile(path, writeYaml(manifest), 'utf8')
  return path
}

export function distributionFromStack(stack: StackManifest, options: {
  kind?: DistributionManifest['kind']
  channel?: DistributionManifest['channel']
  storageId?: string
  base?: DistributionManifest['base']
  createdAt?: string
} = {}): DistributionManifest {
  const kind = options.kind ?? 'derived'
  const channel = options.channel ?? (kind === 'candidate' ? 'rc' : kind === 'base' ? 'stable' : 'working')
  return {
    schemaVersion: 1,
    kind,
    id: stack.id,
    version: stack.version,
    channel,
    ...(options.storageId === undefined ? {} : { storageId: stableStorageId(options.storageId) }),
    harness: {
      version: stack.harness.version,
      adapter: stack.harness.adapter,
      profile: stack.harness.profile,
    },
    profile: { source: './profile' },
    ...(options.base === undefined ? {} : { base: options.base }),
    release: { createdAt: options.createdAt ?? new Date().toISOString(), createdBy: 'dsh-stack' },
  }
}

/** Copy lifecycle metadata while deliberately leaving Profile composition in profile/. */
export async function readDistributionFileIfPresent(root: string): Promise<string | undefined> {
  try {
    return await readFile(join(root, DISTRIBUTION_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export { DISTRIBUTION_FILE }

/** Manually promote a verified Derived Stack into a new immutable Candidate. */
export async function promoteDistribution(options: {
  sourceStack: string
  outputStack: string
  version?: string
  verify: () => Promise<VerificationRun>
}): Promise<{ output: string; manifest: DistributionManifest }> {
  const source = options.sourceStack
  const output = options.outputStack
  const integrity = await verifyIntegrity(source)
  if (integrity.diagnostics.length > 0 || integrity.manifest === undefined) throw new DshStackError(integrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'STATIC_VERIFY', 'Source Stack integrity is invalid'))
  const sourceStack = await readStackManifest(source)
  const sourceDistribution = await readDistributionManifest(source)
  await readAndMatchVerifiedReceipt(source, await options.verify(), {
    id: sourceStack.id,
    version: sourceStack.version,
    integrity: integrity.manifest.artifactHash,
  }, 'FREEZE')
  try {
    await stat(output)
    throw new DshStackError(diagnostic('INVALID_ARGUMENT', 'FREEZE', `Promotion output already exists: ${output}`, { action: 'Choose a new immutable Candidate path.' }), 3)
  } catch (error) {
    if (error instanceof DshStackError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await cp(source, output, { recursive: true, dereference: true })
  await rm(join(output, 'verification.receipt.json'), { force: true })
  await rm(join(output, 'stack.integrity.json'), { force: true })
  const stack = await readStackManifest(output)
  if (options.version !== undefined) {
    stack.version = options.version
    await writeFile(join(output, 'stack.yaml'), writeYaml(stack), 'utf8')
  }
  const manifest = distributionFromStack(stack, {
    kind: 'candidate',
    channel: 'rc',
    storageId: sourceDistribution?.storageId ?? sourceStack.id,
    base: { id: sourceDistribution?.id ?? sourceStack.id, version: sourceDistribution?.version ?? sourceStack.version, integrity: integrity.manifest.artifactHash },
  })
  await writeDistributionManifest(output, manifest)
  await writeIntegrity(output)
  return { output, manifest }
}
