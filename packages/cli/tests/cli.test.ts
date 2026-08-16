import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArgs } from '../src/main.ts'

test('CLI defaults to the official web profile for inspect', () => {
  const args = parseArgs(['inspect'])
  assert.notEqual(args, 'help')
  assert.notEqual(args, 'version')
  if (args === 'help' || args === 'version') return
  assert.equal(args.command, 'inspect')
  assert.equal(args.profile, 'web')
})

test('run requires explicit clean materialization', () => {
  assert.throws(() => parseArgs(['run', 'reference']), /run requires --clean/)
  const args = parseArgs(['run', 'reference', '--clean', '--port', '3199'])
  assert.notEqual(args, 'help')
  assert.notEqual(args, 'version')
  if (args === 'help' || args === 'version') return
  assert.equal(args.clean, true)
  assert.equal(args.port, 3199)
})

test('unknown flags and live verification are explicit', () => {
  assert.throws(() => parseArgs(['inspect', '--wat']), /Unknown option/)
  const args = parseArgs(['verify', 'reference', '--live', '--json'])
  assert.notEqual(args, 'help')
  assert.notEqual(args, 'version')
  if (args === 'help' || args === 'version') return
  assert.equal(args.live, true)
  assert.equal(args.json, true)
})

test('package accepts an explicit native architecture and runtime controls', () => {
  const args = parseArgs(['package', 'reference', '--arch', 'arm64', '--node-runtime', '/tmp/node-arm64', '--signing-identity', 'Developer ID Application: Example', '--hardened-runtime', '--size-report'])
  assert.notEqual(args, 'help')
  assert.notEqual(args, 'version')
  if (args === 'help' || args === 'version') return
  assert.equal(args.command, 'package')
  assert.equal(args.arch, 'arm64')
  assert.equal(args.nodeRuntime, '/tmp/node-arm64')
  assert.equal(args.signingIdentity, 'Developer ID Application: Example')
  assert.equal(args.hardenedRuntime, true)
  assert.equal(args.sizeReport, true)
})

test('package rejects unknown architectures', () => {
  assert.throws(() => parseArgs(['package', 'reference', '--arch', 'universal']), /Invalid macOS architecture/)
})

test('Phase 2 lifecycle commands preserve their explicit path arity', () => {
  const drift = parseArgs(['drift', 'old-base', 'current', '--json', '--report', '/tmp/drift.json'])
  assert.notEqual(drift, 'help')
  assert.notEqual(drift, 'version')
  if (drift === 'help' || drift === 'version') return
  assert.equal(drift.command, 'drift')
  assert.deepEqual(drift.operands, ['old-base', 'current'])
  const update = parseArgs(['update', 'old', 'current', 'new', '--active', '/tmp/active'])
  assert.notEqual(update, 'help')
  assert.notEqual(update, 'version')
  if (update === 'help' || update === 'version') return
  assert.equal(update.command, 'update')
  assert.equal(update.activePath, '/tmp/active')
  assert.throws(() => parseArgs(['update', 'old', 'current', 'new']), /update requires --active/)
})
