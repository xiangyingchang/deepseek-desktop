import { createHash } from 'node:crypto'
import { mkdir, open, readdir, readFile, readlink, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const JOURNAL_FILE = 'update-transaction.json'
const LOCK_FILE = 'update-transaction.lock'
const RUNTIME_LOCK_FILE = 'runtime.lock'
const JOURNAL_SCHEMA = 1

// These are Stack-owned lifecycle paths. Everything else under the stable
// Distribution Storage Identity is opaque User State and is never copied or
// rewritten by Profile Rebase.
const MANAGED_ROOTS = new Set([
  'profiles',
  'base-profile',
  'base-profile.previous',
  'distribution-state.json',
  JOURNAL_FILE,
  `${JOURNAL_FILE}.tmp`,
  'app-update-transaction.json',
  'app-update-transaction.lock',
  RUNTIME_LOCK_FILE,
  LOCK_FILE,
  '.dsh-stack-update',
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function portable(value) {
  return value.split(sep).join('/')
}

function isManaged(relativePath) {
  const first = relativePath.split('/')[0]
  return MANAGED_ROOTS.has(first)
    || first.startsWith('.dsh-stack-update-')
    || first.startsWith('.dsh-stack-app-update-')
}

function safeJournalPath(root, value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const absoluteRoot = resolve(root)
  const absolute = resolve(value)
  if (absolute === absoluteRoot || !absolute.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`Update journal path escapes the stable storage root: ${absolute}`)
  }
  return absolute
}

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function writeAtomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    const handle = await open(temporary, 'w', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

export function resolveStorageId(metadata) {
  const value = typeof metadata?.storageId === 'string' && metadata.storageId.length > 0
    ? metadata.storageId
    : metadata?.id
  if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) return value
  throw new Error('DISTRIBUTION_STORAGE_ID_MISSING: client metadata has no stable storageId or id')
}

export async function readUpdateJournal(root) {
  const journal = await readJson(join(root, JOURNAL_FILE))
  if (journal === undefined) return undefined
  if (journal.schemaVersion !== JOURNAL_SCHEMA || typeof journal.phase !== 'string' || typeof journal.transactionId !== 'string' || journal.transactionId.length === 0) {
    throw new Error(`Unsupported update transaction journal in ${root}`)
  }
  return journal
}

export async function writeUpdateJournal(root, journal) {
  await writeAtomicJson(join(root, JOURNAL_FILE), {
    schemaVersion: JOURNAL_SCHEMA,
    ...journal,
    updatedAt: new Date().toISOString(),
  })
}

export async function clearUpdateJournal(root) {
  await rm(join(root, JOURNAL_FILE), { force: true })
  await rm(join(root, `${JOURNAL_FILE}.tmp`), { force: true })
}

async function collectUserState(root, current = root, output = []) {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return output
    throw error
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const full = join(current, entry.name)
    const relativePath = portable(relative(root, full))
    if (relativePath.length === 0 || isManaged(relativePath)) continue
    if (entry.isDirectory()) {
      await collectUserState(root, full, output)
      continue
    }
    if (entry.isSymbolicLink()) {
      const target = await readlink(full)
      output.push({ path: relativePath, kind: 'symlink', hash: `sha256:${sha256(target)}` })
      continue
    }
    if (entry.isFile()) {
      const bytes = await readFile(full)
      output.push({ path: relativePath, kind: 'file', bytes: bytes.length, hash: `sha256:${sha256(bytes)}` })
      continue
    }
    // Special files are not followed. Their presence is still recorded so a
    // concurrent replacement cannot be silently ignored by the preservation
    // check.
    output.push({ path: relativePath, kind: 'special' })
  }
  return output
}

export async function captureUserState(root) {
  const files = await collectUserState(resolve(root))
  return { schemaVersion: 1, files }
}

export function userStateDigest(snapshot) {
  return `sha256:${sha256(JSON.stringify(snapshot.files))}`
}

export async function assertUserStateUnchanged(root, before) {
  const after = await captureUserState(root)
  if (userStateDigest(before) !== userStateDigest(after)) {
    const beforePaths = new Set(before.files.map(item => item.path))
    const afterPaths = new Set(after.files.map(item => item.path))
    const changed = [...new Set([...beforePaths, ...afterPaths])].filter(path => {
      const left = before.files.find(item => item.path === path)
      const right = after.files.find(item => item.path === path)
      return JSON.stringify(left) !== JSON.stringify(right)
    }).sort()
    throw new Error(`USER_STATE_CHANGED_DURING_UPDATE: ${changed.slice(0, 20).join(', ') || 'unknown state path'}`)
  }
  return after
}

export async function acquireUpdateLock(root) {
  const path = join(root, LOCK_FILE)
  await mkdir(root, { recursive: true })
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n', 'utf8')
    await handle.sync()
    await handle.close()
    return async () => { await rm(path, { force: true }) }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let owner
    try { owner = JSON.parse(await readFile(path, 'utf8')) } catch { owner = undefined }
    if (owner?.pid === process.pid) throw new Error('UPDATE_LOCKED: update transaction is already active in this process')
    if (typeof owner?.pid === 'number') {
      try {
        process.kill(owner.pid, 0)
        throw new Error(`UPDATE_LOCKED: another DeepSeek Desktop update is active (pid ${owner.pid})`)
      } catch (probeError) {
        if (probeError?.code !== 'ESRCH') throw probeError
      }
    }
    await rm(path, { force: true })
    return acquireUpdateLock(root)
  }
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

/** Require the current Harness process to be stopped before App replacement. */
export async function assertRuntimeQuiesced(root) {
  const path = join(root, RUNTIME_LOCK_FILE)
  const owner = await readJson(path)
  if (owner === undefined) return
  if (pidIsAlive(owner.pid)) {
    throw new Error(`APP_UPDATE_REQUIRES_QUIT: the current DeepSeek Desktop runtime is still active (pid ${owner.pid})`)
  }
  await rm(path, { force: true })
}

/** Mark the packaged Harness process as the sole writer of the live User State. */
export async function acquireRuntimeLock(root, metadata = {}) {
  const path = join(root, RUNTIME_LOCK_FILE)
  await mkdir(root, { recursive: true })
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, ...metadata, startedAt: new Date().toISOString() }) + '\n', 'utf8')
    await handle.sync()
    await handle.close()
    await syncDirectory(dirname(path))
    return async () => { await rm(path, { force: true }); await syncDirectory(dirname(path)).catch(() => {}) }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const owner = await readJson(path)
    if (pidIsAlive(owner?.pid)) throw new Error(`UPDATE_LOCKED: another DeepSeek Desktop runtime is active (pid ${owner.pid})`)
    await rm(path, { force: true })
    return acquireRuntimeLock(root, metadata)
  }
}

async function restorePair(activePath, backupPath) {
  if (backupPath === undefined || !(await exists(backupPath))) return
  if (await exists(activePath)) await rm(activePath, { recursive: true, force: true })
  await rename(backupPath, activePath)
}

async function restoreFile(activePath, backupPath, hadFile) {
  if (hadFile === true) {
    if (backupPath === undefined || !(await exists(backupPath))) throw new Error(`Missing lifecycle-state backup: ${activePath}`)
    await rm(activePath, { force: true })
    await rename(backupPath, activePath)
  } else {
    await rm(activePath, { force: true })
  }
}

/**
 * Recover an interrupted Profile/Base transaction. A non-committed journal is
 * always rolled back conservatively; a committed journal only needs cleanup.
 */
export async function recoverUpdateTransaction(root) {
  const journal = await readUpdateJournal(root)
  if (journal === undefined) return { status: 'none' }
  const activeProfile = safeJournalPath(root, journal.activeProfile)
  const backupProfile = safeJournalPath(root, journal.backupProfile)
  const candidateProfile = safeJournalPath(root, journal.candidateProfile)
  const baseSnapshot = safeJournalPath(root, journal.baseSnapshot)
  const backupBaseSnapshot = safeJournalPath(root, journal.backupBaseSnapshot)
  const candidateBaseSnapshot = safeJournalPath(root, journal.candidateBaseSnapshot)
  const lifecycleState = safeJournalPath(root, journal.lifecycleState)
  const lifecycleStateBackup = safeJournalPath(root, journal.lifecycleStateBackup)
  const stagingRoot = safeJournalPath(root, journal.stagingRoot)
  if (journal.phase !== 'committed') {
    if (activeProfile !== undefined && backupProfile !== undefined) await restorePair(activeProfile, backupProfile)
    if (baseSnapshot !== undefined && backupBaseSnapshot !== undefined) await restorePair(baseSnapshot, backupBaseSnapshot)
    if (lifecycleState !== undefined) await restoreFile(lifecycleState, lifecycleStateBackup, journal.hadLifecycleState === true)
  }
  for (const path of [candidateProfile, candidateBaseSnapshot, lifecycleStateBackup, stagingRoot]) {
    if (path !== undefined) await rm(path, { recursive: true, force: true })
  }
  await clearUpdateJournal(root)
  await rm(join(root, LOCK_FILE), { force: true })
  return { status: journal.phase === 'committed' ? 'cleaned' : 'recovered', phase: journal.phase }
}

export const UPDATE_STATE_FILES = { JOURNAL_FILE, LOCK_FILE, RUNTIME_LOCK_FILE }
