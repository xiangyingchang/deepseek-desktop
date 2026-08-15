import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Reference Client embeds the official Web UI in a Native Shell', async () => {
  const shell = await readFile(new URL('../assets/ReferenceShell.swift', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../assets/reference-client.mjs', import.meta.url), 'utf8')

  assert.match(shell, /NSWindow/)
  assert.match(shell, /WKWebView/)
  assert.match(shell, /installApplicationMenu/)
  assert.match(shell, /Selector\(\("paste:"\)\)/u)
  assert.match(shell, /DSH_STACK_READY/)
  assert.match(shell, /environment\.removeValue\(forKey: name\)/u)
  assert.doesNotMatch(shell, /Keychain|Security/u)
  assert.doesNotMatch(shell, /\bopen\s*\(/u)
  assert.match(runtime, /DSH_STACK_READY/)
  assert.match(runtime, /--profile', metadata\.profile/u)
  assert.match(runtime, /storageId/u)
  assert.match(runtime, /delete runtimeEnvironment\[name\]/u)
  assert.doesNotMatch(runtime, /process\.env\[name\]/u)
  assert.doesNotMatch(runtime, /\bopen\s*\(/u)
})
