import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { copyFile, mkdir, readdir, rm, stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DshStackError,
  diagnostic,
  redactSecrets,
  type HarnessInstallation,
  type StackManifest,
} from './index.ts'

interface JsonObject {
  [key: string]: unknown
}

function objectValue(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) await copyTree(from, to)
    else if (entry.isFile()) {
      await mkdir(join(to, '..'), { recursive: true })
      await copyFile(from, to)
    }
  }
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  await new Promise<void>(resolve => server.close(() => resolve()))
  if (address === null || typeof address === 'string') throw new Error('temporary port allocation returned no TCP address')
  return address.port
}

function runtimeEnvironment(base: NodeJS.ProcessEnv, dshHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' }
  for (const key of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) delete env[key]
  return env
}

async function runInstall(profileDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn('pnpm', ['install', '--frozen-lockfile'], {
    cwd: profileDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new DshStackError(diagnostic('FROZEN_INSTALL_FAILED', 'INSTALL', `pnpm --frozen-lockfile exited with code ${exitCode}`, {
      component: 'profile',
      action: 'Repair the Profile lockfile or dependency source and freeze again.',
      details: { stdout: redactSecrets(stdout).slice(-1000), stderr: redactSecrets(stderr).slice(-1000) },
    }))
  }
}

/** A temporary Profile reconstruction shared by Verify and Run. */
export interface MaterializedEnvironment {
  root: string
  dshHome: string
  profileDir: string
  installation: HarnessInstallation
  stack: StackManifest
  installRequired: boolean
  cleanup(): Promise<void>
}

/** Create a fresh DSH home and materialize exact Profile inputs into it. */
export async function materializeStack(options: {
  stackRoot: string
  stack: StackManifest
  installation: HarnessInstallation
  env?: NodeJS.ProcessEnv
}): Promise<MaterializedEnvironment> {
  const root = await (async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    return mkdtemp(join(tmpdir(), 'dsh-stack-materialized-'))
  })()
  const dshHome = join(root, 'dsh-home')
  const profileDir = join(dshHome, 'profiles', options.stack.harness.profile)
  const sourceProfile = join(options.stackRoot, options.stack.profile.source)
  await mkdir(profileDir, { recursive: true })
  try {
    await copyTree(sourceProfile, profileDir)
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw new DshStackError(diagnostic('PROFILE_MATERIALIZATION_FAILED', 'MATERIALIZE', `Unable to copy frozen Profile inputs: ${String(error)}`, {
      component: sourceProfile,
      action: 'Re-freeze the artifact and ensure its profile directory is readable.',
    }))
  }
  const manifest = objectValue(JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')))
  if (manifest === undefined) {
    await rm(root, { recursive: true, force: true })
    throw new DshStackError(diagnostic('PROFILE_MATERIALIZATION_FAILED', 'MATERIALIZE', 'Materialized package.json is not a JSON object', {
      component: join(profileDir, 'package.json'),
      action: 'Re-freeze the source Profile.',
    }))
  }
  const dependencyFields = ['dependencies', 'optionalDependencies', 'devDependencies']
  const dependencyCount = dependencyFields.reduce((count, field) => {
    const values = objectValue(manifest[field])
    return count + (values === undefined ? 0 : Object.keys(values).length)
  }, 0)
  const lockfilePresent = await stat(join(profileDir, 'pnpm-lock.yaml')).then(() => true).catch(() => false)
  const installRequired = lockfilePresent || dependencyCount > 0
  const environment = runtimeEnvironment(options.env ?? process.env, dshHome)
  if (dependencyCount > 0 && !lockfilePresent) {
    await rm(root, { recursive: true, force: true })
    throw new DshStackError(diagnostic('LOCKFILE_MISSING', 'INSTALL', 'Materialized Profile declares dependencies but has no lockfile', {
      action: 'Re-freeze only after the official Profile has a frozen pnpm lockfile.',
    }))
  }
  if (installRequired) {
    try {
      await runInstall(profileDir, environment)
    } catch (error) {
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }
  return {
    root,
    dshHome,
    profileDir,
    installation: options.installation,
    stack: options.stack,
    installRequired,
    cleanup: async () => { await rm(root, { recursive: true, force: true }) },
  }
}

/** Named pipeline seam shared by Verify, Run, and the future Package command. */
export class StackMaterializer {
  async materialize(options: {
    stackRoot: string
    stack: StackManifest
    installation: HarnessInstallation
    env?: NodeJS.ProcessEnv
  }): Promise<MaterializedEnvironment> {
    return materializeStack(options)
  }
}

/** The official Harness process and its sanitized lifecycle output. */
export interface HarnessProcess {
  pid: number | undefined
  url: string
  stdout: string
  stderr: string
  stop(): Promise<void>
}

function appendOutput(target: { value: string }, chunk: unknown): void {
  target.value = redactSecrets((target.value + String(chunk)).slice(-20_000))
}

async function waitForHttp(url: string, child: ChildProcess, output: { stdout: string; stderr: string }): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new DshStackError(diagnostic('HARNESS_BOOT_FAILED', 'BOOT', `Official Harness exited before Web UI became ready (code ${child.exitCode})`, {
        component: 'dsh web',
        action: 'Inspect the sanitized Harness output and verify the exact Harness/Profile pair.',
        details: { stdout: output.stdout.slice(-1000), stderr: output.stderr.slice(-1000) },
      }))
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      const body = await response.text()
      if (response.status >= 200 && response.status < 400 && (body.includes('<!doctype') || body.includes('__DSH_BOOT__'))) return
    } catch {
      // The server may still be mounting the official plugin graph.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new DshStackError(diagnostic('HARNESS_BOOT_FAILED', 'BOOT', `Official Harness Web UI did not become ready at ${url}`, {
    component: 'dsh web',
    action: 'Inspect the sanitized runtime output and rerun with the same artifact.',
    details: { stdout: output.stdout.slice(-1000), stderr: output.stderr.slice(-1000) },
  }))
}

/** Start the official Harness Web UI from a materialized Profile. */
export async function startOfficialWeb(environment: MaterializedEnvironment, options: {
  host?: string
  port?: number
} = {}): Promise<HarnessProcess> {
  const host = options.host ?? environment.installation.web.defaultHost
  const port = options.port ?? await availablePort()
  const args = environment.installation.mode === 'source'
    ? [...environment.installation.cliCommand, 'web', '--host', host, '--port', String(port)]
    : [...environment.installation.cliCommand, 'web', '--host', host, '--port', String(port)]
  const output = { stdout: '', stderr: '' }
  const child = spawn(args[0]!, args.slice(1), {
    cwd: environment.installation.cliCwd,
    env: runtimeEnvironment(process.env, environment.dshHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => appendOutput({ get value() { return output.stdout }, set value(value: string) { output.stdout = value } }, chunk))
  child.stderr.on('data', chunk => appendOutput({ get value() { return output.stderr }, set value(value: string) { output.stderr = value } }, chunk))
  try {
    await waitForHttp(`http://${host}:${port}/`, child, output)
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
  let closed = child.exitCode !== null
  child.once('close', () => { closed = true })
  return {
    pid: child.pid,
    url: `http://${host}:${port}`,
    get stdout() { return output.stdout },
    get stderr() { return output.stderr },
    stop: async () => {
      if (closed) return
      child.kill('SIGTERM')
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          if (!closed) child.kill('SIGKILL')
          resolve()
        }, 5000)
        child.once('close', () => { closed = true; clearTimeout(timer); resolve() })
      })
    },
  }
}
