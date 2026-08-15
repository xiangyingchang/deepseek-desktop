import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = dirname(fileURLToPath(import.meta.url))
const metadata = JSON.parse(await readFile(join(resources, 'client.json'), 'utf8'))
const appData = join(process.env.HOME ?? process.cwd(), 'Library', 'Application Support', 'DSH Stack', metadata.id)
const profileDestination = join(appData, 'profiles', metadata.profile)
const sourceProfile = join(resources, 'profile')
await mkdir(join(appData, 'profiles'), { recursive: true })
if (!existsSync(join(profileDestination, 'package.json'))) await cp(sourceProfile, profileDestination, { recursive: true })

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

const port = await availablePort()
const nodePath = join(resources, 'node')
const harnessBin = join(resources, 'harness', 'lib', 'bin.js')
const url = `http://127.0.0.1:${port}`
const runtimeEnvironment = { ...process.env, DSH_HOME: appData, DSH_TELEMETRY_DISABLED: '1' }
// The official credentials-local provider must own the writable credential
// path. Inherited API-key environment values are deliberately read-only in
// Harness, so never pass Stack-declared secrets into the official process.
for (const name of metadata.secrets) delete runtimeEnvironment[name]
const child = spawn(nodePath, [harnessBin, 'web', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: resources,
  env: runtimeEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', chunk => process.stderr.write(String(chunk).replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')))
child.stderr.on('data', chunk => process.stderr.write(String(chunk).replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]')))
try {
  await waitForWeb(url, child)
  console.log(`DSH_STACK_READY ${url}`)
  await new Promise(resolve => {
    const stop = () => { child.kill('SIGTERM'); resolve() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('close', resolve)
  })
} finally {
  if (child.exitCode === null) child.kill('SIGTERM')
}
