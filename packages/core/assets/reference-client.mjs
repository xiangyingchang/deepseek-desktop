import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'

const resources = dirname(fileURLToPath(import.meta.url))
const metadata = JSON.parse(await readFile(join(resources, 'client.json'), 'utf8'))
const appData = join(process.env.HOME ?? process.cwd(), 'Library', 'Application Support', 'DSH Stack', metadata.id)
const profileDestination = join(appData, 'profiles', metadata.profile)
const sourceProfile = join(resources, 'profile')
await mkdir(join(appData, 'profiles'), { recursive: true })
if (!existsSync(join(profileDestination, 'package.json'))) await cp(sourceProfile, profileDestination, { recursive: true })

function keychainRead(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function keychainWrite(service, value) {
  execFileSync('security', ['add-generic-password', '-U', '-a', process.env.USER ?? 'user', '-s', service, '-w', value], { stdio: ['ignore', 'ignore', 'pipe'] })
}

async function askForSecret(name) {
  const service = `dsh-stack:${metadata.id}:${name}`
  const fromEnvironment = process.env[name]
  if (fromEnvironment) return fromEnvironment
  const fromKeychain = keychainRead(service)
  if (fromKeychain) return fromKeychain
  let value = ''
  if (process.stdin.isTTY) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
    value = (await prompt.question(`Enter ${name}: `)).trim()
    prompt.close()
  } else if (process.platform === 'darwin') {
    try {
      const script = `display dialog "Configure ${name} for DSH Stack" default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save"`
      const response = execFileSync('osascript', ['-e', script], { encoding: 'utf8' })
      value = response.match(/text returned:(.*)/u)?.[1]?.trim() ?? ''
    } catch {
      value = ''
    }
  }
  if (!value) throw new Error(`${name} is required; configure it in the Reference Client prompt or Keychain`)
  keychainWrite(service, value)
  return value
}

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

const secrets = {}
for (const name of metadata.secrets) secrets[name] = await askForSecret(name)
const port = await availablePort()
const nodePath = join(resources, 'node')
const harnessBin = join(resources, 'harness', 'lib', 'bin.js')
const url = `http://127.0.0.1:${port}`
const child = spawn(nodePath, [harnessBin, 'web', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: resources,
  env: { ...process.env, ...secrets, DSH_HOME: appData, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', chunk => process.stderr.write(String(chunk).replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')))
child.stderr.on('data', chunk => process.stderr.write(String(chunk).replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')))
try {
  await waitForWeb(url, child)
  execFileSync('open', [url], { stdio: 'ignore' })
  console.log(`Official DeepSeek Harness Web UI: ${url}`)
  await new Promise(resolve => {
    const stop = () => { child.kill('SIGTERM'); resolve() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('close', resolve)
  })
} finally {
  if (child.exitCode === null) child.kill('SIGTERM')
}
