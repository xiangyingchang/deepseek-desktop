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
