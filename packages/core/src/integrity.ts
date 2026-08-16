import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  asYamlObject,
  diagnostic,
  portableRelativePath,
  readSafeYaml,
  type Diagnostic,
  type IntegrityManifest,
  type StackManifest,
} from './index.ts'

const INTEGRITY_FILE = 'stack.integrity.json'
const RECEIPT_FILE = 'verification.receipt.json'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function artifactFiles(root: string, current = root): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = join(current, entry.name)
    const relativePath = portableRelativePath(relative(root, full))
    if (entry.isDirectory()) output.push(...await artifactFiles(root, full))
    else if (entry.isFile() && relativePath !== INTEGRITY_FILE && relativePath !== RECEIPT_FILE) output.push(relativePath)
    else if (entry.isSymbolicLink()) throw new Error(`Stack artifacts cannot contain symbolic links: ${relativePath}`)
    else if (!entry.isFile()) throw new Error(`Stack artifacts cannot contain special files: ${relativePath}`)
  }
  return output.sort()
}

/** Calculate deterministic SHA-256 entries for one Stack artifact. */
export async function computeIntegrity(root: string): Promise<IntegrityManifest> {
  const files: Record<string, string> = {}
  for (const path of await artifactFiles(root)) {
    files[path] = `sha256-${sha256(await readFile(join(root, path)))}`
  }
  const base = { schemaVersion: 1 as const, algorithm: 'sha256' as const, files }
  return { ...base, artifactHash: `sha256-${sha256(Buffer.from(JSON.stringify(base) + '\n', 'utf8'))}` }
}

/** Write the deterministic integrity manifest. */
export async function writeIntegrity(root: string): Promise<IntegrityManifest> {
  const manifest = await computeIntegrity(root)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(root, INTEGRITY_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}

/** Verify every hashed file and the manifest identity before runtime execution. */
export async function verifyIntegrity(root: string): Promise<{ manifest?: IntegrityManifest; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  let manifest: IntegrityManifest
  try {
    const parsed: unknown = JSON.parse(await readFile(join(root, INTEGRITY_FILE), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('manifest must be an object')
    const candidate = parsed as Partial<IntegrityManifest>
    if (candidate.schemaVersion !== 1 || candidate.algorithm !== 'sha256' || candidate.files === undefined || candidate.artifactHash === undefined) {
      throw new Error('schemaVersion, algorithm, files, and artifactHash are required')
    }
    manifest = candidate as IntegrityManifest
  } catch (error) {
    diagnostics.push(diagnostic('STACK_INTEGRITY_ERROR', 'STATIC_VERIFY', `Unable to read stack.integrity.json: ${String(error)}`, {
      action: 'Re-freeze the Stack artifact with the current CLI.',
    }))
    return { diagnostics }
  }
  let expected: IntegrityManifest
  try {
    expected = await computeIntegrity(root)
  } catch (error) {
    diagnostics.push(diagnostic('STACK_INTEGRITY_ERROR', 'STATIC_VERIFY', `Unable to compute Stack integrity: ${String(error)}`, {
      action: 'Remove symbolic links or special files and re-freeze the Stack artifact.',
    }))
    return { manifest, diagnostics }
  }
  if (JSON.stringify(expected) !== JSON.stringify(manifest)) {
    diagnostics.push(diagnostic('STACK_INTEGRITY_ERROR', 'STATIC_VERIFY', 'Stack integrity does not match its files', {
      component: INTEGRITY_FILE,
      action: 'Do not edit a frozen Stack in place; re-freeze the source Profile.',
    }))
  }
  return { manifest, diagnostics }
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

/** Read and minimally validate the project-owned Stack manifest. */
export async function readStackManifest(root: string): Promise<StackManifest> {
  const value = asYamlObject(await readSafeYaml(join(root, 'stack.yaml')), 'stack.yaml')
  if (value.schemaVersion !== 1) throw new Error('stack.yaml schemaVersion must be 1')
  const profile = asYamlObject(value.profile, 'stack.yaml profile')
  const harness = asYamlObject(value.harness, 'stack.yaml harness')
  const source = asYamlObject(value.source, 'stack.yaml source')
  stringField(value.id, 'stack.yaml id')
  stringField(value.name, 'stack.yaml name')
  stringField(value.version, 'stack.yaml version')
  stringField(harness.version, 'stack.yaml harness.version')
  stringField(harness.adapter, 'stack.yaml harness.adapter')
  stringField(harness.profile, 'stack.yaml harness.profile')
  if (profile.source !== './profile' || !Array.isArray(profile.inputs)) throw new Error('stack.yaml profile.source/inputs are invalid')
  if (source.consistency !== 'verified' && source.consistency !== 'unverified') throw new Error('stack.yaml source.consistency is invalid')
  return value as unknown as StackManifest
}
