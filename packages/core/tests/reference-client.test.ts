import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Reference Client embeds the official Web UI in a Native Shell', async () => {
  const shell = await readFile(new URL('../assets/ReferenceShell.swift', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../assets/reference-client.mjs', import.meta.url), 'utf8')

  assert.match(shell, /NSWindow/)
  assert.match(shell, /WKWebView/)
  assert.match(shell, /DSH_STACK_READY/)
  assert.doesNotMatch(shell, /\bopen\s*\(/u)
  assert.match(runtime, /DSH_STACK_READY/)
  assert.doesNotMatch(runtime, /\bopen\s*\(/u)
})
