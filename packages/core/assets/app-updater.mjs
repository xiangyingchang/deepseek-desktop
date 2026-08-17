import { execFile as execFileCallback, spawn } from 'node:child_process'
import { cp, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  assertRuntimeQuiesced,
  assertUserStateUnchanged,
  captureUserState,
  readJson,
  resolveStorageId,
  writeAtomicJson,
} from './update-state.mjs'

const execFile = promisify(execFileCallback)
const APP_JOURNAL = 'app-update-transaction.json'
const APP_LOCK = 'app-update-transaction.lock'

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

function appResources(appPath) {
  return join(appPath, 'Contents', 'Resources')
}

async function readClientMetadata(appPath) {
  const metadata = JSON.parse(await readFile(join(appResources(appPath), 'client.json'), 'utf8'))
  return { ...metadata, profile: safeProfileName(metadata.profile), storageId: resolveStorageId(metadata) }
}

function safeAppPath(value, field) {
  const path = resolve(value)
  if (!path.endsWith('.app')) throw new Error(`APP_UPDATE_INVALID: ${field} must point to a .app bundle`)
  return path
}

function safeProfileName(value) {
  if (typeof value !== 'string' || value.length === 0 || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error('APP_UPDATE_INVALID: client metadata contains an unsafe Profile name')
  }
  return value
}

function safePathInside(root, value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`APP_UPDATE_RECOVERY_FAILED: Journal is missing ${field}`)
  const absoluteRoot = resolve(root)
  const absolute = resolve(value)
  if (absolute === absoluteRoot || !absolute.startsWith(`${absoluteRoot}/`)) throw new Error(`APP_UPDATE_RECOVERY_FAILED: Journal ${field} escapes the User State root`)
  return absolute
}

function assertSha256(value, field) {
  if (typeof value !== 'string' || !/^sha256-[a-f0-9]{64}$/u.test(value)) throw new Error(`APP_UPDATE_INVALID: ${field} is not a valid artifact integrity hash`)
}

export async function verifyPackagedProof(appPath) {
  const metadata = await readClientMetadata(appPath)
  const integrity = JSON.parse(await readFile(join(appResources(appPath), 'stack.integrity.json'), 'utf8'))
  const receipt = JSON.parse(await readFile(join(appResources(appPath), 'verification.receipt.json'), 'utf8'))
  assertSha256(metadata.baseIntegrity, 'client.baseIntegrity')
  if (integrity?.schemaVersion !== 1 || integrity?.algorithm !== 'sha256' || integrity?.files === null || typeof integrity?.files !== 'object' || Array.isArray(integrity.files)) throw new Error('APP_UPDATE_INVALID: embedded Stack Integrity manifest is incomplete')
  if (integrity.artifactHash !== metadata.baseIntegrity) throw new Error('APP_UPDATE_INVALID: client metadata does not bind the embedded Stack Integrity manifest')
  if (receipt?.stack?.id !== metadata.id || receipt?.stack?.version !== metadata.baseVersion || receipt?.stack?.integrity !== metadata.baseIntegrity) throw new Error('APP_UPDATE_INVALID: Verification Receipt does not bind the candidate Distribution')
  if (receipt?.verification?.level !== 'runtime' || receipt?.verification?.result !== 'pass' || receipt?.verification?.cacheUsed !== false || receipt?.thirdPartyCodeExecuted !== true || !Array.isArray(receipt?.stages) || !Array.isArray(receipt?.checks) || !Array.isArray(receipt?.diagnostics) || receipt.diagnostics.length !== 0) throw new Error('APP_UPDATE_INVALID: candidate Verification Receipt is not a complete Runtime PASS')
  const requiredStages = ['STATIC_VERIFY', 'MATERIALIZE', 'BOOT', 'ACTIVATE', 'CORE_TEST']
  if (!requiredStages.every(stage => receipt.stages.some(item => item?.stage === stage && item?.status === 'passed'))) throw new Error('APP_UPDATE_INVALID: candidate Verification Receipt is missing a required passed stage')
  if (receipt?.distribution?.storageId !== metadata.storageId) throw new Error('APP_UPDATE_INVALID: Verification Receipt Storage Identity does not match the candidate App')
  return { metadata, integrity, receipt }
}

const MACHO_MAGICS = new Set([0xFEEDFACE, 0xFEEDFACF, 0xCAFEBABE, 0xBEBAFECA, 0xCEFAEDFE, 0xCFFAEDFE])

async function isMachOFile(path) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(4)
    const { bytesRead } = await handle.read(buffer, 0, 4, 0)
    if (bytesRead < 4) return false
    return MACHO_MAGICS.has(buffer.readUInt32BE(0)) || MACHO_MAGICS.has(buffer.readUInt32LE(0))
  } finally {
    await handle.close()
  }
}

// `codesign --verify --deep` does not validate nested Mach-O binaries in
// non-standard locations (bare executables under Resources/, prebuilt
// libraries inside node_modules). A candidate App whose embedded runtime
// carries a stale signature installs fine and is SIGKILLed by AMFI on first
// launch, so every embedded binary is verified individually.
async function verifyEmbeddedMachOSignatures(appPath) {
  const failures = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && await isMachOFile(path)) {
        try {
          await execFile('/usr/bin/codesign', ['--verify', '--strict', path])
        } catch (error) {
          const detail = String(error.stderr ?? error.message ?? error).trim()
          failures.push(`${path}: ${detail}`)
        }
      }
    }
  }
  await walk(join(appPath, 'Contents'))
  if (failures.length > 0) throw new Error(`APP_UPDATE_INVALID: embedded Mach-O signature verification failed (${failures.length} failure${failures.length === 1 ? '' : 's'}): ${failures.join('; ')}`)
}

async function verifyBundle(appPath) {
  const required = [
    join(appResources(appPath), 'client.json'),
    join(appResources(appPath), 'node'),
    join(appResources(appPath), 'reference-client.mjs'),
    join(appResources(appPath), 'update-state.mjs'),
    join(appResources(appPath), 'app-updater.mjs'),
    join(appResources(appPath), 'stack.integrity.json'),
    join(appResources(appPath), 'verification.receipt.json'),
    join(appPath, 'Contents', 'MacOS', 'deepseek-desktop'),
  ]
  for (const path of required) if (!await exists(path)) throw new Error(`APP_UPDATE_INVALID: candidate is missing ${path}`)
  await verifyPackagedProof(appPath)
  await execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  await verifyEmbeddedMachOSignatures(appPath)
}

async function copyIfPresent(source, target) {
  if (!await exists(source)) return false
  // Preserve Harness-managed symlink closures. Dereferencing a generated
  // profiles/node_modules link turns a valid Profile into a false boot failure
  // and can accidentally copy a machine-local closure into preflight.
  await cp(source, target, { recursive: true, dereference: false, verbatimSymlinks: true })
  return true
}

async function prepareManagedPreflight(appData, preflightRoot) {
  await rm(preflightRoot, { recursive: true, force: true })
  await mkdir(preflightRoot, { recursive: true })
  await copyIfPresent(join(appData, 'profiles'), join(preflightRoot, 'profiles'))
  await copyIfPresent(join(appData, 'base-profile'), join(preflightRoot, 'base-profile'))
  await copyIfPresent(join(appData, 'distribution-state.json'), join(preflightRoot, 'distribution-state.json'))
}

async function acquireAppUpdateLock(appData) {
  const path = join(appData, APP_LOCK)
  await mkdir(appData, { recursive: true })
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n', 'utf8')
    await handle.sync()
    await handle.close()
    return async () => { await rm(path, { force: true }) }
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('APP_UPDATE_LOCKED: another App update is already active')
    throw error
  }
}

function runHealthCheck(appPath, appData, metadata, timeoutMs = 90000) {
  const resources = appResources(appPath)
  const node = join(resources, 'node')
  const script = join(resources, 'reference-client.mjs')
  const environment = { ...process.env, DSH_HOME: appData, DSH_STACK_APP_DATA: appData, DSH_STACK_ACTIVE_APP: appPath, DSH_STACK_APP_UPDATE_HEALTH_CHECK: '1', DSH_TELEMETRY_DISABLED: '1' }
  for (const name of Array.isArray(metadata?.secrets) ? metadata.secrets : []) delete environment[name]
  return new Promise((resolveHealth, rejectHealth) => {
    const child = spawn(node, [script, '--health-check'], { cwd: resources, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = ''
    child.stdout.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000) })
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectHealth(new Error(`APP_UPDATE_HEALTH_CHECK_TIMEOUT: ${diagnostics}`))
    }, timeoutMs)
    child.once('error', error => {
      clearTimeout(timer)
      rejectHealth(error)
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolveHealth()
      else rejectHealth(new Error(`APP_UPDATE_HEALTH_CHECK_FAILED(${code ?? 'unknown'}): ${diagnostics}`))
    })
  })
}

async function restoreLifecycleState(journal) {
  if (journal.hadLifecycleState === true) {
    if (!await exists(journal.lifecycleStateBackup)) throw new Error('APP_UPDATE_RECOVERY_FAILED: lifecycle state backup is missing')
    await rm(journal.lifecycleState, { force: true })
    await rename(journal.lifecycleStateBackup, journal.lifecycleState)
  } else await rm(journal.lifecycleState, { force: true })
}

async function restoreManagedProfile(journal) {
  if (journal.baseChanged !== true) return
  const lifecycle = await readJson(journal.lifecycleState)
  // Do not consume a stale `.previous` from an older successful update. Only
  // restore Profile/Base backups when the current lifecycle metadata proves
  // that this transaction's new Base was activated.
  if (lifecycle?.baseIntegrity !== journal.newBaseIntegrity) return
  const profile = join(journal.appData, 'profiles', journal.profile)
  const profileBackup = `${profile}.previous`
  const base = join(journal.appData, 'base-profile')
  const baseBackup = `${base}.previous`
  if (await exists(profileBackup)) {
    await rm(profile, { recursive: true, force: true })
    await rename(profileBackup, profile)
  }
  if (await exists(baseBackup)) {
    await rm(base, { recursive: true, force: true })
    await rename(baseBackup, base)
  }
  await restoreLifecycleState(journal)
}

async function restoreAppBundle(journal) {
  if (await exists(journal.backupApp)) {
    if (await exists(journal.activeApp)) await rm(journal.activeApp, { recursive: true, force: true })
    await rename(journal.backupApp, journal.activeApp)
  }
  await rm(journal.stagedApp, { recursive: true, force: true })
}

async function cleanupOldAppBackups(activeApp, keepBackup) {
  const parent = dirname(activeApp)
  const prefix = `${basename(activeApp)}.previous-`
  let entries
  try { entries = await readdir(parent, { withFileTypes: true }) } catch { return }
  await Promise.all(entries
    .filter(entry => entry.name.startsWith(prefix) && join(parent, entry.name) !== keepBackup)
    .map(entry => rm(join(parent, entry.name), { recursive: true, force: true }).catch(() => {})))
}

function journalPath(root) {
  return join(root, APP_JOURNAL)
}

async function clearAppJournal(root) {
  await rm(journalPath(root), { force: true })
}

async function readAppJournal(appData) {
  return readJson(journalPath(appData))
}

function assertJournalShape(journal, appData, expectedActiveApp) {
  if (journal === undefined || journal.schemaVersion !== 1 || typeof journal.transactionId !== 'string') throw new Error('APP_UPDATE_RECOVERY_FAILED: invalid App update Journal')
  if (resolve(journal.appData) !== resolve(appData)) throw new Error('APP_UPDATE_RECOVERY_FAILED: App update Journal belongs to another User State root')
  if (!/^[A-Za-z0-9._-]+$/u.test(journal.transactionId)) throw new Error('APP_UPDATE_RECOVERY_FAILED: invalid App update transaction id')
  const activeApp = safeAppPath(journal.activeApp, 'Journal activeApp')
  if (activeApp === resolve(appData) || activeApp === '/') throw new Error('APP_UPDATE_RECOVERY_FAILED: invalid Journal active App path')
  if (expectedActiveApp !== undefined && activeApp !== safeAppPath(expectedActiveApp, 'expectedActiveApp')) throw new Error('APP_UPDATE_RECOVERY_FAILED: Journal active App does not match the running App')
  const expectedBackup = `${journal.activeApp}.previous-${journal.transactionId}.app`
  const expectedStaged = `${journal.activeApp}.candidate-${journal.transactionId}.app`
  if (journal.backupApp !== expectedBackup || journal.stagedApp !== expectedStaged) throw new Error('APP_UPDATE_RECOVERY_FAILED: App update Journal paths are inconsistent')
  const transactionRoot = safePathInside(appData, journal.transactionRoot, 'transactionRoot')
  if (transactionRoot !== join(resolve(appData), `.dsh-stack-app-update-${journal.transactionId}`)) throw new Error('APP_UPDATE_RECOVERY_FAILED: invalid App transaction root')
  if (safePathInside(appData, journal.preflightRoot, 'preflightRoot') !== join(transactionRoot, 'preflight-data')) throw new Error('APP_UPDATE_RECOVERY_FAILED: invalid App preflight root')
  if (safePathInside(appData, journal.lifecycleState, 'lifecycleState') !== join(resolve(appData), 'distribution-state.json')) throw new Error('APP_UPDATE_RECOVERY_FAILED: invalid App lifecycle path')
  if (safePathInside(appData, journal.lifecycleStateBackup, 'lifecycleStateBackup') !== join(transactionRoot, 'distribution-state.previous.json')) throw new Error('APP_UPDATE_RECOVERY_FAILED: invalid App lifecycle backup path')
  safeProfileName(journal.profile)
}

export async function recoverApplicationUpdate(appData, currentAppVersion, expectedActiveApp = process.env.DSH_STACK_ACTIVE_APP) {
  const journal = await readAppJournal(appData)
  if (journal === undefined) return { status: 'none' }
  if (expectedActiveApp === undefined) throw new Error('APP_UPDATE_RECOVERY_FAILED: active App anchor is required to recover a pending transaction')
  assertJournalShape(journal, appData, expectedActiveApp)
  if (journal.phase === 'app-switched' && typeof journal.newAppVersion === 'string' && currentAppVersion === journal.newAppVersion) {
    const attempts = Number(journal.healthAttempts) || 0
    if (attempts === 0) {
      await writeAtomicJson(journalPath(appData), { ...journal, healthAttempts: 1, healthStartedAt: new Date().toISOString() })
      return { status: 'pending', phase: journal.phase }
    }
  }
  if (journal.phase !== 'committed') {
    await restoreManagedProfile(journal)
    await restoreAppBundle(journal)
    await rm(journal.transactionRoot, { recursive: true, force: true })
    await clearAppJournal(appData)
    await rm(join(appData, APP_LOCK), { force: true })
    return { status: 'recovered', phase: journal.phase }
  }
  await rm(journal.transactionRoot, { recursive: true, force: true })
  await clearAppJournal(appData)
  await rm(join(appData, APP_LOCK), { force: true })
  return { status: 'cleaned', phase: journal.phase }
}

export async function commitApplicationUpdate(appData, currentAppVersion, expectedActiveApp = process.env.DSH_STACK_ACTIVE_APP) {
  const journal = await readAppJournal(appData)
  if (journal === undefined) return { status: 'none' }
  if (expectedActiveApp === undefined) throw new Error('APP_UPDATE_COMMIT_FAILED: active App anchor is required to commit a pending transaction')
  assertJournalShape(journal, appData, expectedActiveApp)
  if (journal.phase !== 'app-switched' || currentAppVersion !== journal.newAppVersion) throw new Error('APP_UPDATE_COMMIT_FAILED: current App does not match the staged update')
  await writeAtomicJson(journalPath(appData), { ...journal, phase: 'committed', committedAt: new Date().toISOString() })
  await rm(journal.transactionRoot, { recursive: true, force: true })
  await clearAppJournal(appData)
  await rm(join(appData, APP_LOCK), { force: true })
  await cleanupOldAppBackups(journal.activeApp, journal.backupApp)
  return { status: 'committed', appVersion: journal.newAppVersion }
}

export async function installApplicationUpdate(options) {
  const candidateApp = safeAppPath(options.candidateApp, 'candidateApp')
  const activeApp = safeAppPath(options.activeApp, 'activeApp')
  const appData = resolve(options.appData)
  if (!(await exists(activeApp))) throw new Error(`APP_UPDATE_INVALID: active App does not exist: ${activeApp}`)
  if (!(await exists(candidateApp))) throw new Error(`APP_UPDATE_INVALID: candidate App does not exist: ${candidateApp}`)
  const current = await readClientMetadata(activeApp)
  const candidate = await readClientMetadata(candidateApp)
  if (current.id !== candidate.id || current.storageId !== candidate.storageId) throw new Error('APP_UPDATE_INVALID: candidate Distribution identity or Storage Identity does not match the installed App')
  const runtimeArchitecture = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch
  if (candidate.architecture !== undefined && candidate.architecture !== runtimeArchitecture) throw new Error(`APP_UPDATE_INVALID: candidate architecture ${candidate.architecture} does not match runtime ${runtimeArchitecture}`)
  if (current.architecture !== undefined && candidate.architecture !== undefined && current.architecture !== candidate.architecture) throw new Error('APP_UPDATE_INVALID: candidate architecture does not match the installed App architecture')
  if (current.appVersion === candidate.appVersion && current.baseIntegrity === candidate.baseIntegrity) throw new Error('APP_UPDATE_NOT_NEEDED: candidate App/Base identity matches the installed App')
  await verifyBundle(candidateApp)
  const releaseLock = await acquireAppUpdateLock(appData)
  let userStateBefore
  try {
    await assertRuntimeQuiesced(appData)
    userStateBefore = await captureUserState(appData)
    const transactionId = `${Date.now()}-${process.pid}`
    const transactionRoot = join(appData, `.dsh-stack-app-update-${transactionId}`)
    const preflightRoot = join(transactionRoot, 'preflight-data')
    const lifecycleState = join(appData, 'distribution-state.json')
    const lifecycleStateBackup = join(transactionRoot, 'distribution-state.previous.json')
    const stagedApp = `${activeApp}.candidate-${transactionId}.app`
    const backupApp = `${activeApp}.previous-${transactionId}.app`
    const journal = {
      schemaVersion: 1,
      transactionId,
      phase: 'staging',
      appData,
      activeApp,
      backupApp,
      stagedApp,
      transactionRoot,
      preflightRoot,
      lifecycleState,
      lifecycleStateBackup,
      hadLifecycleState: await exists(lifecycleState),
      profile: candidate.profile,
      baseChanged: current.baseIntegrity !== candidate.baseIntegrity,
      oldAppVersion: current.appVersion,
      newAppVersion: candidate.appVersion,
      oldBaseIntegrity: current.baseIntegrity,
      newBaseIntegrity: candidate.baseIntegrity,
      userStateDigest: (await import('./update-state.mjs')).userStateDigest(userStateBefore),
    }
    await mkdir(transactionRoot, { recursive: true })
    if (journal.hadLifecycleState) await cp(lifecycleState, lifecycleStateBackup)
    await writeAtomicJson(journalPath(appData), journal)
    await prepareManagedPreflight(appData, preflightRoot)
    await cp(candidateApp, stagedApp, { recursive: true, dereference: true })
    await runHealthCheck(stagedApp, preflightRoot, candidate, options.timeoutMs ?? 90000)
    await writeAtomicJson(journalPath(appData), { ...journal, phase: 'ready-to-switch' })
    await rename(activeApp, backupApp)
    await writeAtomicJson(journalPath(appData), { ...journal, phase: 'app-backed-up' })
    await rename(stagedApp, activeApp)
    await writeAtomicJson(journalPath(appData), { ...journal, phase: 'app-switched' })
    await assertUserStateUnchanged(appData, userStateBefore)
    return { status: 'staged', activeApp, previousApp: backupApp, appVersion: candidate.appVersion, baseIntegrity: candidate.baseIntegrity }
  } catch (error) {
    try {
      const persisted = await readAppJournal(appData)
      if (persisted !== undefined) {
        assertJournalShape(persisted, appData, activeApp)
        await restoreManagedProfile(persisted)
        await restoreAppBundle(persisted)
        await rm(persisted.transactionRoot, { recursive: true, force: true })
        await clearAppJournal(appData)
      }
      if (userStateBefore !== undefined) await assertUserStateUnchanged(appData, userStateBefore)
    } catch (recoveryError) {
      throw new Error(`${String(error)}; APP_UPDATE_RECOVERY_FAILED: ${String(recoveryError)}`)
    }
    throw error
  } finally {
    await releaseLock()
  }
}

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--candidate') result.candidateApp = argv[++index]
    else if (token === '--active') result.activeApp = argv[++index]
    else if (token === '--app-data') result.appData = argv[++index]
    else if (token === '--recover') result.recover = true
    else if (token === '--json') result.json = true
    else throw new Error(`APP_UPDATE_INVALID: unknown option ${token}`)
  }
  return result
}

if (process.argv[1]?.endsWith('/app-updater.mjs') === true) {
  try {
    const args = parseArguments(process.argv.slice(2))
    if (args.appData === undefined) throw new Error('APP_UPDATE_INVALID: --app-data is required')
    const result = args.recover === true
      ? await recoverApplicationUpdate(resolve(args.appData))
      : await installApplicationUpdate(args)
    if (args.json === true) console.log(JSON.stringify(result, null, 2))
    else console.log(`APP_UPDATE_${String(result.status).toUpperCase()}`)
  } catch (error) {
    console.error(String(error))
    process.exitCode = 1
  }
}
