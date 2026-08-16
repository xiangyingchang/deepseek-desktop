import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const state = await import(new URL('../assets/update-state.mjs', import.meta.url).href)

test('Storage Identity is stable and cannot escape the Application Support root', () => {
  assert.equal(state.resolveStorageId({ id: 'dsh-web' }), 'dsh-web')
  assert.equal(state.resolveStorageId({ id: 'dsh-web', storageId: 'stable-web' }), 'stable-web')
  assert.throws(() => state.resolveStorageId({ id: '../other' }), /DISTRIBUTION_STORAGE_ID_MISSING/u)
})

test('Runtime lock blocks App replacement until the Harness process is gone', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-runtime-lock-')
  try {
    const release = await state.acquireRuntimeLock(root, { appPid: 'fixture' })
    await assert.rejects(state.assertRuntimeQuiesced(root), /APP_UPDATE_REQUIRES_QUIT/u)
    await release()
    await state.assertRuntimeQuiesced(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('User State fingerprint excludes Stack-owned paths and detects mutation without exposing values', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-update-state-')
  try {
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await mkdir(join(root, 'base-profile'), { recursive: true })
    await mkdir(join(root, 'sessions'), { recursive: true })
    await writeFile(join(root, 'profiles', 'web', 'package.json'), 'managed\n', 'utf8')
    await writeFile(join(root, 'base-profile', 'package.json'), 'managed-base\n', 'utf8')
    await writeFile(join(root, '.credentials.yaml'), 'apiKey: secret-value\n', 'utf8')
    await writeFile(join(root, 'sessions', 'history.json'), '{"turns":1}\n', 'utf8')
    await writeFile(join(root, 'distribution-state.json'), '{"baseIntegrity":"old"}\n', 'utf8')

    const before = await state.captureUserState(root)
    assert.deepEqual(before.files.map((item: { path: string }) => item.path), ['.credentials.yaml', 'sessions/history.json'])
    assert.equal(state.userStateDigest(before).includes('secret-value'), false)

    await writeFile(join(root, 'profiles', 'web', 'package.json'), 'changed-managed\n', 'utf8')
    await state.assertUserStateUnchanged(root, before)

    await writeFile(join(root, 'sessions', 'history.json'), '{"turns":2}\n', 'utf8')
    await assert.rejects(state.assertUserStateUnchanged(root, before), /USER_STATE_CHANGED_DURING_UPDATE/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Interrupted Profile/Base/lifecycle transaction restores the old working environment', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-update-recovery-')
  try {
    const activeProfile = join(root, 'profiles', 'web')
    const backupProfile = join(root, 'profiles', 'web.previous')
    const baseSnapshot = join(root, 'base-profile')
    const backupBaseSnapshot = join(root, 'base-profile.previous')
    const stagingRoot = join(root, '.dsh-stack-update-1')
    const candidateProfile = join(stagingRoot, 'profile')
    const candidateBaseSnapshot = join(stagingRoot, 'base-profile')
    const lifecycleState = join(root, 'distribution-state.json')
    const lifecycleStateBackup = join(stagingRoot, 'distribution-state.previous.json')
    await mkdir(activeProfile, { recursive: true })
    await mkdir(backupProfile, { recursive: true })
    await mkdir(baseSnapshot, { recursive: true })
    await mkdir(backupBaseSnapshot, { recursive: true })
    await mkdir(candidateProfile, { recursive: true })
    await mkdir(candidateBaseSnapshot, { recursive: true })
    await writeFile(join(activeProfile, 'marker'), 'new-profile\n', 'utf8')
    await writeFile(join(backupProfile, 'marker'), 'old-profile\n', 'utf8')
    await writeFile(join(baseSnapshot, 'marker'), 'new-base\n', 'utf8')
    await writeFile(join(backupBaseSnapshot, 'marker'), 'old-base\n', 'utf8')
    await writeFile(join(candidateProfile, 'marker'), 'candidate\n', 'utf8')
    await writeFile(join(candidateBaseSnapshot, 'marker'), 'candidate-base\n', 'utf8')
    await writeFile(join(stagingRoot, 'distribution-state.previous.json'), '{"baseIntegrity":"old"}\n', 'utf8')
    await writeFile(lifecycleState, '{"baseIntegrity":"new"}\n', 'utf8')
    await writeFile(join(root, '.credentials.yaml'), 'apiKey: preserved\n', 'utf8')

    await state.writeUpdateJournal(root, {
      transactionId: 'fixture-update-1',
      phase: 'base-switched',
      activeProfile,
      backupProfile,
      candidateProfile,
      baseSnapshot,
      backupBaseSnapshot,
      candidateBaseSnapshot,
      lifecycleState,
      lifecycleStateBackup,
      hadLifecycleState: true,
      stagingRoot,
    })

    const result = await state.recoverUpdateTransaction(root)
    assert.equal(result.status, 'recovered')
    assert.equal(await readFile(join(activeProfile, 'marker'), 'utf8'), 'old-profile\n')
    assert.equal(await readFile(join(baseSnapshot, 'marker'), 'utf8'), 'old-base\n')
    assert.equal(await readFile(lifecycleState, 'utf8'), '{"baseIntegrity":"old"}\n')
    assert.equal(await readFile(join(root, '.credentials.yaml'), 'utf8'), 'apiKey: preserved\n')
    await assert.rejects(access(join(root, 'update-transaction.json')))
    await assert.rejects(access(stagingRoot))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Committed transaction cleanup does not roll back the verified new state', async () => {
  const root = await mkdtemp('/tmp/dsh-stack-update-commit-')
  try {
    const activeProfile = join(root, 'profiles', 'web')
    const backupProfile = join(root, 'profiles', 'web.previous')
    const stagingRoot = join(root, '.dsh-stack-update-2')
    await mkdir(activeProfile, { recursive: true })
    await mkdir(backupProfile, { recursive: true })
    await mkdir(stagingRoot, { recursive: true })
    await writeFile(join(activeProfile, 'marker'), 'new-profile\n', 'utf8')
    await writeFile(join(backupProfile, 'marker'), 'old-profile\n', 'utf8')
    await state.writeUpdateJournal(root, { transactionId: 'fixture-update-2', phase: 'committed', activeProfile, backupProfile, stagingRoot })

    const result = await state.recoverUpdateTransaction(root)
    assert.equal(result.status, 'cleaned')
    assert.equal(await readFile(join(activeProfile, 'marker'), 'utf8'), 'new-profile\n')
    await access(backupProfile)
    await assert.rejects(access(join(root, 'update-transaction.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
