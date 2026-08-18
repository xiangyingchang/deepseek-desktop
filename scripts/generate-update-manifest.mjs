#!/usr/bin/env node
/**
 * Generate a schemaVersion 1 Update Manifest from one release output directory.
 *
 * The directory must contain exactly one `.app` bundle (with the packaged
 * `client.json`, `verification.receipt.json`, and `Info.plist`), exactly one
 * `.dmg`, its `.dmg.sha256`, and the copied `-verification.receipt.json`.
 * This is exactly the layout produced by scripts/build-macos-reference.sh.
 *
 * Usage:
 *   node scripts/generate-update-manifest.mjs \
 *     --dist dist/release/v0.2.0-rc.10 \
 *     --tag v0.2.0-rc.10 \
 *     [--repo xiangyingchang/deepseek-desktop]  # default: parsed from git origin
 *     [--channel rc]                            # default: client.json updateChannel
 *     [--minimum-macos 12.0]                    # default: app LSMinimumSystemVersion
 *     [--out dist/release/v0.2.0-rc.10/update-manifest.json]
 *
 * Asset URLs point at the immutable tag download URL. Publish the generated
 * file as `update-manifest.json` on the GitHub Release so the evergreen feed
 * URL `https://github.com/<repo>/releases/latest/download/update-manifest.json`
 * keeps serving the newest manifest.
 */
import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHA256_HEX = /^[a-f0-9]{64}$/u
const ARTIFACT_INTEGRITY = /^sha256-[a-f0-9]{64}$/u
const ARCHS = new Set(['x64', 'arm64'])
const CHANNELS = new Set(['stable', 'rc'])

export function parseGitHubRepo(remoteUrl) {
  const value = String(remoteUrl ?? '').trim().replace(/\.git$/u, '')
  const https = value.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/u)
  if (https !== null) return `${https[1]}/${https[2]}`
  const ssh = value.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/u)
  if (ssh !== null) return `${ssh[1]}/${ssh[2]}`
  return undefined
}

function defaultRepo() {
  let remote
  try {
    remote = execFileSync('git', ['-C', REPO_ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
  return parseGitHubRepo(remote)
}

function fail(message) {
  throw new Error(`UPDATE_MANIFEST_GENERATION_FAILED: ${message}`)
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${field} is missing or empty`)
  return value.trim()
}

async function readJson(path, field) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    fail(`${field} could not be read (${path}): ${String(error.message ?? error)}`)
  }
  return parsed
}

async function singleEntry(distDir, predicate, kind) {
  const entries = await readdir(distDir, { withFileTypes: true })
  const matches = entries.filter(entry => entry.isFile() && predicate(entry.name))
  if (matches.length !== 1) fail(`expected exactly one ${kind} in ${distDir}, found ${matches.length}: ${matches.map(entry => entry.name).join(', ') || '(none)'}`)
  return matches[0].name
}

function readMinimumMacOS(plistText) {
  const match = plistText.match(/<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)<\/string>/u)
  return match === null ? undefined : match[1].trim()
}

/**
 * Build (and locally sanity-check) one Update Manifest from a release output
 * directory. Mirrors the validation rules of packages/core/src/update-manifest.ts
 * and the ReferenceShell.swift update check so an invalid manifest never ships.
 */
export async function buildUpdateManifest(options) {
  const distDir = resolve(requireString(options.distDir, '--dist'))
  const tag = requireString(options.tag, '--tag')
  if (!/^v?[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(tag)) fail(`--tag contains unsupported characters: ${tag}`)
  const repo = requireString(options.repo ?? defaultRepo(), '--repo (or git origin)')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) fail(`--repo must look like owner/name: ${repo}`)

  const appEntries = (await readdir(distDir, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
  if (appEntries.length !== 1) fail(`expected exactly one .app bundle in ${distDir}, found ${appEntries.length}`)
  const appPath = join(distDir, appEntries[0].name)

  const client = await readJson(join(appPath, 'Contents', 'Resources', 'client.json'), 'client.json')
  const receipt = await readJson(join(appPath, 'Contents', 'Resources', 'verification.receipt.json'), 'embedded verification receipt')
  const dmgName = await singleEntry(distDir, name => name.endsWith('.dmg'), 'release DMG')
  const receiptName = await singleEntry(distDir, name => name.endsWith('-verification.receipt.json'), 'release verification receipt')

  const distributionId = requireString(client.id, 'client.json id')
  const appVersion = requireString(client.appVersion, 'client.json appVersion')
  const baseVersion = requireString(client.baseVersion, 'client.json baseVersion')
  const baseIntegrity = requireString(client.baseIntegrity, 'client.json baseIntegrity')
  if (!ARTIFACT_INTEGRITY.test(baseIntegrity)) fail(`client.json baseIntegrity must be sha256-<64 hex>: ${baseIntegrity}`)
  const arch = requireString(client.architecture, 'client.json architecture')
  if (!ARCHS.has(arch)) fail(`client.json architecture must be x64 or arm64: ${arch}`)

  const harnessVersion = requireString(receipt?.harness?.version, 'verification receipt harness.version')

  let channel = options.channel ?? client.updateChannel
  if (typeof channel !== 'string' || channel.trim().length === 0) channel = 'rc'
  channel = channel.trim()
  if (!CHANNELS.has(channel)) fail(`channel must be stable or rc: ${channel}`)

  let minimumMacOS = options.minimumMacOS
  if (minimumMacOS === undefined) {
    const plist = await readFile(join(appPath, 'Contents', 'Info.plist'), 'utf8')
    minimumMacOS = readMinimumMacOS(plist) ?? '12.0'
  }
  minimumMacOS = requireString(minimumMacOS, 'minimumMacOS')

  const sha256File = await readFile(join(distDir, `${dmgName}.sha256`), 'utf8')
  const shaMatch = sha256File.match(/[a-fA-F0-9]{64}/u)
  if (shaMatch === null) fail(`${dmgName}.sha256 does not contain a 64-character hex digest`)
  const sha256 = shaMatch[0].toLowerCase()
  if (!SHA256_HEX.test(sha256)) fail(`DMG SHA-256 digest is invalid: ${sha256}`)

  const bytes = (await stat(join(distDir, dmgName))).size
  if (!Number.isSafeInteger(bytes) || bytes <= 0) fail(`DMG byte size is not a positive integer: ${bytes}`)

  const releaseBase = `https://github.com/${repo}/releases/download/${tag}`
  const manifest = {
    schemaVersion: 1,
    distributionId,
    channel,
    appVersion,
    baseVersion,
    baseIntegrity,
    harnessVersion,
    minimumMacOS,
    assets: [{
      arch,
      url: `${releaseBase}/${encodeURIComponent(dmgName)}`,
      sha256,
      baseIntegrity,
      bytes,
      receiptUrl: `${releaseBase}/${encodeURIComponent(receiptName)}`,
    }],
    releaseNotesUrl: `https://github.com/${repo}/releases`,
    publishedAt: options.publishedAt ?? new Date().toISOString(),
  }
  return manifest
}

async function main() {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string' },
      tag: { type: 'string' },
      repo: { type: 'string' },
      channel: { type: 'string' },
      'minimum-macos': { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (values.dist === undefined || values.tag === undefined) {
    console.error('Usage: node scripts/generate-update-manifest.mjs --dist <release output dir> --tag <release tag> [--repo owner/name] [--channel rc] [--minimum-macos 12.0] [--out <path>]')
    process.exit(3)
  }
  const manifest = await buildUpdateManifest({
    distDir: values.dist,
    tag: values.tag,
    repo: values.repo,
    channel: values.channel,
    minimumMacOS: values.minimumMacOS,
  })
  const out = resolve(values.out ?? join(values.dist, 'update-manifest.json'))
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Update Manifest written: ${out}`)
  console.log(`  appVersion: ${manifest.appVersion} (${manifest.assets[0].arch}, channel ${manifest.channel})`)
  console.log(`  asset: ${manifest.assets[0].url}`)
  console.log(`  evergreen feed: https://github.com/${manifest.assets[0].url.split('/releases/download/')[0].replace('https://github.com/', '')}/releases/latest/download/update-manifest.json`)
  console.log('  Publish this file on the GitHub Release. Do NOT mark the Release as a prerelease,')
  console.log('  or releases/latest will stop resolving to it.')
}

const invokedAsScript = process.argv[1] !== undefined
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  main().catch(error => {
    console.error(String(error.message ?? error))
    process.exit(1)
  })
}
