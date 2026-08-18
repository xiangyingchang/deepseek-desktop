#!/usr/bin/env node
/**
 * Merge one Update Manifest per native architecture into the single manifest
 * consumed by the desktop updater.
 *
 * Every architecture is still built and verified independently. This command
 * only combines the resulting release metadata; it does not materialize or
 * alter a Profile.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildUpdateManifest } from './generate-update-manifest.mjs'

const ARCHS = new Set(['x64', 'arm64'])

function fail(message) {
  throw new Error(`UPDATE_MANIFEST_MERGE_FAILED: ${message}`)
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${field} is missing or empty`)
  return value.trim()
}

function sameMetadata(manifests) {
  const fields = [
    'schemaVersion',
    'distributionId',
    'channel',
    'appVersion',
    'baseVersion',
    'baseIntegrity',
    'harnessVersion',
    'minimumMacOS',
    'releaseNotesUrl',
  ]
  const first = manifests[0]
  for (const field of fields) {
    for (const manifest of manifests.slice(1)) {
      if (manifest[field] !== first[field]) {
        fail(`manifest metadata differs for ${field}: ${String(first[field])} vs ${String(manifest[field])}`)
      }
    }
  }
}

/**
 * Merge validated single-architecture manifests. The architecture entries
 * must be unique and are returned in deterministic x64, arm64 order.
 */
export function mergeUpdateManifests(manifests) {
  if (!Array.isArray(manifests) || manifests.length === 0) fail('at least one manifest is required')
  sameMetadata(manifests)

  const assets = manifests.flatMap(manifest => {
    if (!Array.isArray(manifest.assets) || manifest.assets.length !== 1) {
      fail('each input manifest must contain exactly one asset')
    }
    return manifest.assets
  })
  const seen = new Set()
  for (const asset of assets) {
    if (!ARCHS.has(asset.arch)) fail(`unsupported asset architecture: ${String(asset.arch)}`)
    if (seen.has(asset.arch)) fail(`duplicate asset architecture: ${asset.arch}`)
    seen.add(asset.arch)
  }

  return {
    ...manifests[0],
    assets: assets.sort((left, right) => {
      const order = { x64: 0, arm64: 1 }
      return order[left.arch] - order[right.arch]
    }),
    publishedAt: manifests
      .map(manifest => manifest.publishedAt)
      .filter(value => typeof value === 'string' && value.length > 0)
      .sort()
      .at(-1),
  }
}

export async function buildCombinedUpdateManifest(options) {
  const distDirs = options.distDirs
  if (!Array.isArray(distDirs) || distDirs.length === 0) fail('distDirs is empty')
  const publishedAt = options.publishedAt ?? new Date().toISOString()
  const manifests = await Promise.all(distDirs.map(distDir => buildUpdateManifest({
    ...options,
    distDir,
    publishedAt,
  })))
  return mergeUpdateManifests(manifests)
}

async function main() {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', multiple: true },
      tag: { type: 'string' },
      repo: { type: 'string' },
      channel: { type: 'string' },
      'minimum-macos': { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (values.dist === undefined || values.tag === undefined) {
    console.error('Usage: node scripts/merge-update-manifest.mjs --dist <x64-dir> --dist <arm64-dir> --tag <release-tag> [--repo owner/name] [--channel rc] [--out <path>]')
    process.exit(3)
  }

  const manifest = await buildCombinedUpdateManifest({
    distDirs: values.dist,
    tag: values.tag,
    repo: values.repo,
    channel: values.channel,
    minimumMacOS: values.minimumMacOS,
  })
  const out = resolve(values.out ?? 'dist/release/update-manifest.json')
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Combined Update Manifest written: ${out}`)
  console.log(`  appVersion: ${manifest.appVersion} (${manifest.assets.map(asset => asset.arch).join(', ')}, channel ${manifest.channel})`)
  console.log(`  assets: ${manifest.assets.length}`)
}

const invokedAsScript = process.argv[1] !== undefined
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  main().catch(error => {
    console.error(String(error.message ?? error))
    process.exit(1)
  })
}
