import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const resources = dirname(fileURLToPath(import.meta.url))
const metadata = JSON.parse(await readFile(join(resources, 'client.json'), 'utf8'))
// Keep the data directory stable across Base releases. The embedded Base
// integrity changes on update; using it as the directory name would create a
// fresh Profile and make user-installed bundles disappear.
const storageId = typeof metadata.storageId === 'string' && metadata.storageId.length > 0 ? metadata.storageId : metadata.id
const appData = join(process.env.HOME ?? process.cwd(), 'Library', 'Application Support', 'DSH Stack', storageId)
const profileDestination = join(appData, 'profiles', metadata.profile)
const sourceProfile = join(resources, 'profile')
const baseSnapshot = join(appData, 'base-profile')
const lifecycleState = join(appData, 'distribution-state.json')
await mkdir(join(appData, 'profiles'), { recursive: true })

async function loadYamlModule() {
  const candidates = [
    join(resources, 'harness', 'node_modules', 'js-yaml', 'index.js'),
    join(resources, 'harness', 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const module = await import(pathToFileURL(candidate).href)
      return module.default ?? module
    } catch {
      // Try the next deployed module layout; do not downgrade a conflict to PASS.
    }
  }
  return undefined
}

async function writeLifecycleState() {
  await writeFile(lifecycleState, JSON.stringify({
    schemaVersion: 1,
    distributionId: metadata.id,
    baseVersion: metadata.baseVersion,
    baseIntegrity: metadata.baseIntegrity,
    profile: metadata.profile,
  }, null, 2) + '\n', 'utf8')
}

async function readLifecycleState() {
  try { return JSON.parse(await readFile(lifecycleState, 'utf8')) } catch { return undefined }
}

async function verifyCandidateProfile(candidateProfile) {
  const root = join(appData, `.verify-${Date.now()}`)
  const dshHome = join(root, 'dsh-home')
  const profile = join(dshHome, 'profiles', metadata.profile)
  await mkdir(join(dshHome, 'profiles'), { recursive: true })
  await cp(candidateProfile, profile, { recursive: true, dereference: true })
  const port = await availablePort()
  const child = spawn(join(resources, 'node'), [join(resources, 'harness', 'lib', 'bin.js'), '--profile', metadata.profile, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: resources,
    env: (() => {
      const value = { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' }
      for (const name of metadata.secrets) delete value[name]
      return value
    })(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.stdout.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000) })
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000) })
  try {
    await waitForWeb(`http://127.0.0.1:${port}`, child)
  } catch (error) {
    throw new Error(`UPDATE_VERIFY_FAILED: ${String(error)}\n${diagnostics}`)
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

async function updateDerivedProfileIfNeeded() {
  if (!existsSync(join(profileDestination, 'package.json'))) {
    await cp(sourceProfile, profileDestination, { recursive: true, dereference: true })
    await rm(baseSnapshot, { recursive: true, force: true }).catch(() => {})
    await cp(sourceProfile, baseSnapshot, { recursive: true, dereference: true })
    await writeLifecycleState()
    return
  }
  const state = await readLifecycleState()
  if (state?.baseIntegrity === metadata.baseIntegrity && existsSync(join(baseSnapshot, 'package.json'))) return
  if (!existsSync(join(baseSnapshot, 'package.json'))) {
    // A pre-lifecycle installation has no trustworthy old Base snapshot. Keep
    // its working Profile intact and establish a baseline for the next update.
    await cp(profileDestination, baseSnapshot, { recursive: true, dereference: true })
    await writeLifecycleState()
    return
  }
  const yaml = await loadYamlModule()
  if (yaml === undefined) throw new Error('UPDATE_BLOCKED: the packaged Harness does not expose the safe YAML parser required for Profile Rebase')
  const rebase = await import(pathToFileURL(join(resources, 'profile-rebase.mjs')).href)
  const stagingRoot = join(appData, `.rebase-${Date.now()}`)
  const candidateProfile = join(stagingRoot, 'profile')
  try {
    const report = await rebase.rebaseProfiles({ oldBase: baseSnapshot, current: profileDestination, newBase: sourceProfile, output: candidateProfile, yaml })
    if (report.status !== 'PASS') throw new Error(`UPDATE_REBASE_CONFLICT: ${JSON.stringify(report.conflicts)}`)
    // Do not resolve dependencies here. Retain the user's already-installed
    // packages and overlay the new Base closure; the official runtime proves
    // the resulting standard Profile before activation.
    await rebase.mergeDependencyClosure({ baseProfile: sourceProfile, currentProfile: profileDestination, candidateProfile })
    await verifyCandidateProfile(candidateProfile)
    const backup = `${profileDestination}.previous`
    await rm(backup, { recursive: true, force: true }).catch(() => {})
    await rename(profileDestination, backup)
    try {
      await rename(candidateProfile, profileDestination)
    } catch (error) {
      await rename(backup, profileDestination).catch(() => {})
      throw error
    }
    await rm(baseSnapshot, { recursive: true, force: true })
    await cp(sourceProfile, baseSnapshot, { recursive: true, dereference: true })
    await writeLifecycleState()
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
  }
}

await updateDerivedProfileIfNeeded()

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise(resolve => server.close(resolve))
  if (!address || typeof address === 'string') throw new Error('unable to allocate a local port')
  return address.port
}

async function waitForWeb(url, child) {
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode !== null) throw new Error(`official Harness exited before the Web UI became ready (code ${child.exitCode})`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      // The official Harness is still booting its plugin graph.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`official Harness Web UI did not become ready at ${url}`)
}

const port = await availablePort()
const nodePath = join(resources, 'node')
const harnessBin = join(resources, 'harness', 'lib', 'bin.js')
const url = `http://127.0.0.1:${port}`
const runtimeEnvironment = { ...process.env, DSH_HOME: appData, DSH_TELEMETRY_DISABLED: '1' }
// The official credentials-local provider must own the writable credential
// path. Inherited API-key environment values are deliberately read-only in
// Harness, so never pass Stack-declared secrets into the official process.
for (const name of metadata.secrets) delete runtimeEnvironment[name]
const child = spawn(nodePath, [harnessBin, '--profile', metadata.profile, '--host', '127.0.0.1', '--port', String(port)], {
  cwd: resources,
  env: runtimeEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', chunk => process.stderr.write(String(chunk).replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')))
child.stderr.on('data', chunk => process.stderr.write(String(chunk).replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')))
try {
  await waitForWeb(url, child)
  console.log(`DSH_STACK_READY ${url}`)
  await new Promise(resolve => {
    const stop = () => { child.kill('SIGTERM'); resolve() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('close', resolve)
  })
} finally {
  if (child.exitCode === null) child.kill('SIGTERM')
}
