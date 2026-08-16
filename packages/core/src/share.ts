import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { DshStackError, diagnostic } from './errors.ts'
import { readStackManifest, verifyIntegrity } from './integrity.ts'
import { detectSecretIndicators } from './redaction.ts'
import { readAndMatchVerifiedReceipt } from './receipt.ts'
import type { VerificationReceipt, VerificationRun } from './types.ts'

const execFileAsync = promisify(execFile)
const ARCHIVE_ENTRIES = ['stack.yaml', 'distribution.yaml', 'profile', 'tests', 'stack.integrity.json', 'verification.receipt.json']
const FORBIDDEN_PARTS = new Set(['.git', 'node_modules', '.dsh', 'cache', 'caches', 'sessions', 'session', 'logs', 'tmp'])
const FORBIDDEN_FILES = new Set(['.env', '.env.local', '.env.production', 'credentials.yaml', '.credentials.yaml', 'history.json'])

async function walk(root: string, current = root): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = join(current, entry.name)
    const path = relative(root, full).split('\\').join('/')
    if (entry.isDirectory()) output.push(...await walk(root, full))
    else if (entry.isFile()) output.push(path)
    else throw new DshStackError(diagnostic('SHARE_ARTIFACT_ERROR', 'PACK', `Shareable Stack contains a non-regular entry: ${path}`, {
      component: path,
      action: 'Remove symbolic links and special files before Pack; artifacts must contain regular files only.',
    }))
  }
  return output.sort()
}

function forbidden(path: string): boolean {
  const parts = path.split('/')
  return parts.some(part => FORBIDDEN_PARTS.has(part)) || FORBIDDEN_FILES.has(basename(path))
}

async function assertShareableContents(root: string): Promise<void> {
  const files = await walk(root)
  for (const path of files) {
    if (forbidden(path)) throw new DshStackError(diagnostic('USER_STATE_LEAK', 'PACK', `Shareable Stack contains excluded user state: ${path}`, {
      component: path,
      action: 'Remove credentials, sessions, caches, logs, and generated runtime data before Pack.',
    }))
    const bytes = await readFile(join(root, path))
    const indicators = detectSecretIndicators(path, bytes.toString('utf8'))
    if (indicators.length > 0) throw new DshStackError(diagnostic('SECRET_DETECTED', 'PACK', `Shareable Stack contains a likely secret in ${path}`, {
      component: path,
      action: 'Remove the secret value; `.dshstack` never includes API keys or credentials.',
    }))
  }
  const topLevel = new Set(files.map(path => path.split('/')[0]!))
  for (const item of topLevel) if (!['stack.yaml', 'distribution.yaml', 'profile', 'tests', 'stack.integrity.json', 'verification.receipt.json'].includes(item)) {
    throw new DshStackError(diagnostic('USER_STATE_LEAK', 'PACK', `Shareable Stack contains an unapproved top-level entry: ${item}`, {
      action: 'Keep only Stack metadata, Profile inputs, tests, integrity, and the verification receipt.',
    }))
  }
}

async function assertOutputAbsent(path: string): Promise<void> {
  try {
    await access(path)
    throw new DshStackError(diagnostic('SHARE_ARTIFACT_ERROR', 'PACK', `Shareable output already exists: ${path}`, {
      action: 'Choose a new output path; Pack never overwrites an existing artifact.',
    }))
  } catch (error) {
    if (error instanceof DshStackError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Pack a verified Stack as the default, state-free sharing artifact. */
export async function packShareableStack(options: {
  stackRoot: string
  output: string
  verify: () => Promise<VerificationRun>
}): Promise<{ output: string; receipt: VerificationReceipt; files: string[] }> {
  const root = resolve(options.stackRoot)
  const output = resolve(options.output)
  const integrity = await verifyIntegrity(root)
  if (integrity.diagnostics.length > 0 || integrity.manifest === undefined) throw new DshStackError(integrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'PACK', 'Stack integrity is invalid'))
  const stack = await readStackManifest(root)
  const receipt = await readAndMatchVerifiedReceipt(root, await options.verify(), {
    id: stack.id,
    version: stack.version,
    integrity: integrity.manifest.artifactHash,
  }, 'PACK')
  await assertShareableContents(root)
  await assertOutputAbsent(output)
  await mkdir(dirname(output), { recursive: true })
  const existing = []
  for (const entry of ARCHIVE_ENTRIES) {
    try { await stat(join(root, entry)); existing.push(entry) } catch { /* optional distribution metadata */ }
  }
  try {
    await execFileAsync('zip', ['-q', '-r', output, ...existing], { cwd: root, maxBuffer: 1024 * 1024 })
  } catch (error) {
    throw new DshStackError(diagnostic('SHARE_ARTIFACT_ERROR', 'PACK', `Unable to create .dshstack archive: ${String(error)}`, {
      action: 'Install the host zip utility or run Pack on a supported desktop environment.',
    }))
  }
  return { output, receipt, files: existing }
}

function assertSafeArchiveEntry(path: string): void {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || forbidden(normalized)) throw new DshStackError(diagnostic('SHARE_ARTIFACT_ERROR', 'PACK', `Unsafe or state-bearing archive entry: ${path}`, {
    action: 'Reject archives containing path traversal, dependencies, credentials, or user state.',
  }))
}

/** Extract a `.dshstack` only after inspecting its entries for traversal/state leaks. */
export async function importShareableStack(options: { archive: string; output: string }): Promise<{ output: string; files: string[] }> {
  const archive = resolve(options.archive)
  const output = resolve(options.output)
  await assertOutputAbsent(output)
  let listing: string
  try {
    const result = await execFileAsync('unzip', ['-Z1', archive], { maxBuffer: 1024 * 1024 })
    listing = result.stdout
  } catch (error) {
    throw new DshStackError(diagnostic('SHARE_ARTIFACT_ERROR', 'PACK', `Unable to inspect .dshstack archive: ${String(error)}`, {
      action: 'Pass a valid DSH Stack archive created by dsh-stack pack.',
    }))
  }
  const files = listing.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
  for (const path of files) assertSafeArchiveEntry(path)
  if (!files.includes('stack.yaml') || !files.includes('stack.integrity.json') || !files.includes('verification.receipt.json')) throw new DshStackError(diagnostic('SHARE_ARTIFACT_ERROR', 'PACK', 'Archive is missing Stack metadata or its Verification Receipt', {
    action: 'Create the artifact with dsh-stack pack after Runtime Verify.',
  }))
  await mkdir(dirname(output), { recursive: true })
  const staging = `${output}.import-${process.pid}-${Date.now()}`
  await mkdir(staging, { recursive: true })
  try {
    await execFileAsync('unzip', ['-q', archive, '-d', staging], { maxBuffer: 1024 * 1024 })
    await assertShareableContents(staging)
    const integrity = await verifyIntegrity(staging)
    if (integrity.diagnostics.length > 0) throw new DshStackError(integrity.diagnostics[0]!)
    await rename(staging, output)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    if (error instanceof DshStackError) throw error
    throw new DshStackError(diagnostic('SHARE_ARTIFACT_ERROR', 'PACK', `Unable to extract .dshstack archive: ${String(error)}`, {
      action: 'Inspect the archive and retry Import.',
    }))
  }
  return { output, files }
}
