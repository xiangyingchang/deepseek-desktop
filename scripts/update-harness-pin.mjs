#!/usr/bin/env node
/**
 * Promote an already verified official Harness checkout into the committed
 * source pin used by CI and the scheduled upstream monitor.
 *
 * This script intentionally does not fetch, merge, install, build, or verify
 * Harness. Run it only after `harness-update --apply` has completed its guarded
 * candidate verification. It only records the clean checkout's exact commit
 * and CLI version in the pin file.
 */
import { execFile as execFileCallback } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const USAGE =
  'Usage: node scripts/update-harness-pin.mjs ' +
  '[--harness ../deepseek-harness] [--pin config/harness-pin.json]'

const { values } = parseArgs({
  options: {
    harness: { type: 'string', default: '../deepseek-harness' },
    pin: { type: 'string', default: 'config/harness-pin.json' },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

function fail(message) {
  console.error(`Harness pin promotion blocked: ${message}`)
  process.exit(1)
}

function objectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail(`pin field ${field} must be a non-empty string`)
  return value
}

async function git(root, args) {
  try {
    const result = await execFile('git', args, { cwd: root, encoding: 'utf8' })
    return result.stdout.trim()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(`git ${args.join(' ')} failed: ${detail}`)
  }
}

function repositoryFromRemote(remote) {
  const normalized = remote.trim().replace(/\.git$/u, '')
  const match = normalized.match(/(?:github\.com[/:])([^/]+\/[^/]+)$/u)
  return match?.[1]
}

const harnessRoot = resolve(values.harness)
const pinPath = resolve(values.pin)
let pin
try {
  pin = JSON.parse(await readFile(pinPath, 'utf8'))
} catch (error) {
  fail(`cannot read pin file ${pinPath}: ${error instanceof Error ? error.message : String(error)}`)
}
const pinObject = objectValue(pin)
if (pinObject === undefined || pinObject.schemaVersion !== 1) fail(`unsupported pin schema in ${pinPath}`)
const repository = requireString(pinObject.repository, 'repository')
requireString(pinObject.upstreamRef, 'upstreamRef')
requireString(pinObject.commit, 'commit')

const status = await git(harnessRoot, ['status', '--porcelain'])
if (status !== '') fail(`Harness checkout is dirty (${status.split(/\r?\n/u).length} change(s)); commit or stash it first`)

const remote = await git(harnessRoot, ['remote', 'get-url', 'origin'])
const remoteRepository = repositoryFromRemote(remote)
if (remoteRepository !== repository) {
  fail(`origin points to ${remoteRepository ?? remote}, expected ${repository}`)
}

const commit = await git(harnessRoot, ['rev-parse', 'HEAD'])
if (!/^[0-9a-f]{40}$/u.test(commit)) fail(`Harness HEAD is not a full commit SHA: ${commit}`)

let cliManifest
try {
  cliManifest = JSON.parse(await readFile(join(harnessRoot, 'apps', 'cli', 'package.json'), 'utf8'))
} catch (error) {
  fail(`cannot read official Harness CLI manifest: ${error instanceof Error ? error.message : String(error)}`)
}
const cliObject = objectValue(cliManifest)
const version = requireString(cliObject?.version, 'apps/cli/package.json version')

const nextPin = { ...pinObject, version, commit }
if (pinObject.commit === commit && pinObject.version === version) {
  console.log(`Harness pin already current: ${version} @ ${commit}`)
  process.exit(0)
}

await writeFile(pinPath, `${JSON.stringify(nextPin, null, 2)}\n`, 'utf8')
console.log(`Harness pin updated: ${version} @ ${commit}`)
