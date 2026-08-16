import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const updater = await import(new URL('../assets/app-updater.mjs', import.meta.url).href)
const state = await import(new URL('../assets/update-state.mjs', import.meta.url).href)

test('App update recovery restores App, Profile, Base, lifecycle metadata, and leaves User State untouched', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-app-recovery-')
  try {
    const appData = join(root, 'app-data')
    const activeApp = join(root, 'DeepSeek Desktop (Unofficial).app')
    const transactionId = 'fixture-1'
    const backupApp = `${activeApp}.previous-${transactionId}.app`
    const stagedApp = `${activeApp}.candidate-${transactionId}.app`
    const transactionRoot = join(appData, `.dsh-stack-app-update-${transactionId}`)
    const lifecycleState = join(appData, 'distribution-state.json')
    const lifecycleStateBackup = join(transactionRoot, 'distribution-state.previous.json')
    await mkdir(join(activeApp, 'Contents'), { recursive: true })
    await mkdir(join(backupApp, 'Contents'), { recursive: true })
    await mkdir(join(stagedApp, 'Contents'), { recursive: true })
    await mkdir(join(appData, 'profiles', 'web'), { recursive: true })
    await mkdir(join(appData, 'profiles', 'web.previous'), { recursive: true })
    await mkdir(join(appData, 'base-profile'), { recursive: true })
    await mkdir(join(appData, 'base-profile.previous'), { recursive: true })
    await mkdir(transactionRoot, { recursive: true })
    await writeFile(join(activeApp, 'marker'), 'new-app\n', 'utf8')
    await writeFile(join(backupApp, 'marker'), 'old-app\n', 'utf8')
    await writeFile(join(stagedApp, 'marker'), 'staged-app\n', 'utf8')
    await writeFile(join(appData, 'profiles', 'web', 'marker'), 'new-profile\n', 'utf8')
    await writeFile(join(appData, 'profiles', 'web.previous', 'marker'), 'old-profile\n', 'utf8')
    await writeFile(join(appData, 'base-profile', 'marker'), 'new-base\n', 'utf8')
    await writeFile(join(appData, 'base-profile.previous', 'marker'), 'old-base\n', 'utf8')
    await writeFile(lifecycleState, '{"baseIntegrity":"new"}\n', 'utf8')
    await writeFile(lifecycleStateBackup, '{"baseIntegrity":"old"}\n', 'utf8')
    await writeFile(join(appData, '.credentials.yaml'), 'apiKey: untouched\n', 'utf8')
    await state.writeAtomicJson(join(appData, 'app-update-transaction.json'), {
      schemaVersion: 1,
      transactionId,
      phase: 'app-switched',
      appData,
      activeApp,
      backupApp,
      stagedApp,
      transactionRoot,
      preflightRoot: join(transactionRoot, 'preflight-data'),
      lifecycleState,
      lifecycleStateBackup,
      hadLifecycleState: true,
      profile: 'web',
      baseChanged: true,
      newBaseIntegrity: 'new',
    })

    const result = await updater.recoverApplicationUpdate(appData, undefined, activeApp)
    assert.equal(result.status, 'recovered')
    assert.equal(await readFile(join(activeApp, 'marker'), 'utf8'), 'old-app\n')
    assert.equal(await readFile(join(appData, 'profiles', 'web', 'marker'), 'utf8'), 'old-profile\n')
    assert.equal(await readFile(join(appData, 'base-profile', 'marker'), 'utf8'), 'old-base\n')
    assert.equal(await readFile(lifecycleState, 'utf8'), '{"baseIntegrity":"old"}\n')
    assert.equal(await readFile(join(appData, '.credentials.yaml'), 'utf8'), 'apiKey: untouched\n')
    await assert.rejects(access(join(appData, 'app-update-transaction.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('App update first launch is pending until Health Check commits it', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-app-pending-')
  try {
    const appData = join(root, 'app-data')
    const activeApp = join(root, 'DeepSeek Desktop (Unofficial).app')
    const transactionId = 'fixture-2'
    const backupApp = `${activeApp}.previous-${transactionId}.app`
    const olderBackupApp = `${activeApp}.previous-older.app`
    const stagedApp = `${activeApp}.candidate-${transactionId}.app`
    const transactionRoot = join(appData, `.dsh-stack-app-update-${transactionId}`)
    await mkdir(join(activeApp, 'Contents'), { recursive: true })
    await mkdir(join(backupApp, 'Contents'), { recursive: true })
    await mkdir(join(olderBackupApp, 'Contents'), { recursive: true })
    await mkdir(transactionRoot, { recursive: true })
    await writeFile(join(activeApp, 'marker'), 'new-app\n', 'utf8')
    await writeFile(join(backupApp, 'marker'), 'old-app\n', 'utf8')
    await state.writeAtomicJson(join(appData, 'app-update-transaction.json'), {
      schemaVersion: 1,
      transactionId,
      phase: 'app-switched',
      appData,
      activeApp,
      backupApp,
      stagedApp,
      transactionRoot,
      preflightRoot: join(transactionRoot, 'preflight-data'),
      lifecycleState: join(appData, 'distribution-state.json'),
      lifecycleStateBackup: join(transactionRoot, 'distribution-state.previous.json'),
      hadLifecycleState: false,
      profile: 'web',
      baseChanged: false,
      newAppVersion: '0.2.0',
    })

    const pending = await updater.recoverApplicationUpdate(appData, '0.2.0', activeApp)
    assert.equal(pending.status, 'pending')
    const committed = await updater.commitApplicationUpdate(appData, '0.2.0', activeApp)
    assert.equal(committed.status, 'committed')
    assert.equal(await readFile(join(activeApp, 'marker'), 'utf8'), 'new-app\n')
    assert.equal(await readFile(join(backupApp, 'marker'), 'utf8'), 'old-app\n')
    await assert.rejects(access(olderBackupApp))
    await assert.rejects(access(join(appData, 'app-update-transaction.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('App updater rejects a candidate for the wrong native architecture before staging', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-app-architecture-')
  try {
    const appData = join(root, 'app-data')
    const activeApp = join(root, 'DeepSeek Desktop (Unofficial).app')
    const candidateApp = join(root, 'candidate.app')
    const currentArchitecture = process.arch === 'arm64' ? 'arm64' : 'x64'
    const wrongArchitecture = currentArchitecture === 'arm64' ? 'x64' : 'arm64'
    const metadata = {
      id: 'dsh-web',
      storageId: 'dsh-web-5590c2a0cb00b3a7',
      architecture: currentArchitecture,
      appVersion: '0.1.0',
      baseIntegrity: 'sha256-old',
      profile: 'web',
    }
    await mkdir(join(activeApp, 'Contents', 'Resources'), { recursive: true })
    await mkdir(join(candidateApp, 'Contents', 'Resources'), { recursive: true })
    await writeFile(join(activeApp, 'Contents', 'Resources', 'client.json'), `${JSON.stringify(metadata)}\n`, 'utf8')
    await writeFile(join(candidateApp, 'Contents', 'Resources', 'client.json'), `${JSON.stringify({ ...metadata, architecture: wrongArchitecture, appVersion: '0.2.0', baseIntegrity: 'sha256-new' })}\n`, 'utf8')

    await assert.rejects(
      updater.installApplicationUpdate({ candidateApp, activeApp, appData }),
      /candidate architecture .* does not match runtime/u,
    )
    await access(activeApp)
    await access(candidateApp)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('App update recovery rejects a Journal anchored to another App path', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-app-journal-anchor-')
  try {
    const appData = join(root, 'app-data')
    const activeApp = join(root, 'DeepSeek Desktop (Unofficial).app')
    const victimApp = join(root, 'unrelated.app')
    const transactionId = 'fixture-anchor'
    const transactionRoot = join(appData, `.dsh-stack-app-update-${transactionId}`)
    await mkdir(join(victimApp, 'Contents'), { recursive: true })
    await writeFile(join(victimApp, 'marker'), 'must-survive\n', 'utf8')
    await mkdir(transactionRoot, { recursive: true })
    await state.writeAtomicJson(join(appData, 'app-update-transaction.json'), {
      schemaVersion: 1,
      transactionId,
      phase: 'app-switched',
      appData,
      activeApp: victimApp,
      backupApp: `${victimApp}.previous-${transactionId}.app`,
      stagedApp: `${victimApp}.candidate-${transactionId}.app`,
      transactionRoot,
      preflightRoot: join(transactionRoot, 'preflight-data'),
      lifecycleState: join(appData, 'distribution-state.json'),
      lifecycleStateBackup: join(transactionRoot, 'distribution-state.previous.json'),
      hadLifecycleState: false,
      profile: 'web',
      baseChanged: false,
    })

    await assert.rejects(
      updater.recoverApplicationUpdate(appData, '0.2.0', activeApp),
      /does not match the running App/u,
    )
    assert.equal(await readFile(join(victimApp, 'marker'), 'utf8'), 'must-survive\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('App updater rejects a candidate whose Receipt does not bind Stack Integrity', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-app-proof-')
  try {
    const app = join(root, 'candidate.app')
    const resources = join(app, 'Contents', 'Resources')
    const integrity = `sha256-${'a'.repeat(64)}`
    await mkdir(resources, { recursive: true })
    await writeFile(join(resources, 'client.json'), `${JSON.stringify({ id: 'dsh-web', storageId: 'dsh-web-5590c2a0cb00b3a7', profile: 'web', baseVersion: '0.1.0', baseIntegrity: integrity })}\n`, 'utf8')
    await writeFile(join(resources, 'stack.integrity.json'), `${JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files: {}, artifactHash: `sha256-${'b'.repeat(64)}` })}\n`, 'utf8')
    await writeFile(join(resources, 'verification.receipt.json'), `${JSON.stringify({ stack: { id: 'dsh-web', version: '0.1.0', integrity }, verification: { level: 'runtime', result: 'pass', cacheUsed: false }, diagnostics: [], distribution: { storageId: 'dsh-web-5590c2a0cb00b3a7' } })}\n`, 'utf8')

    await assert.rejects(updater.verifyPackagedProof(app), /does not bind the embedded Stack Integrity/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
