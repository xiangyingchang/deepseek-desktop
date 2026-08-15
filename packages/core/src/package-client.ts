import { execFileSync, spawn } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DshStackError,
  diagnostic,
  readStackManifest,
  type HarnessInstallation,
  type IntegrityManifest,
  type VerificationReceipt,
} from './index.ts'
import { SourceHarnessAdapter, currentPlatform } from './source-adapter.ts'
import { verifyIntegrity } from './integrity.ts'

const ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

async function runDeploy(harnessRoot: string, destination: string): Promise<void> {
  const args = [
    '--filter', '@deepseek-ai/dsh',
    'deploy', '--legacy', '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    destination,
  ]
  const child = spawn('pnpm', args, { cwd: harnessRoot, stdio: 'inherit' })
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', value => resolve(value ?? 1))
  })
  if (code !== 0) throw new DshStackError(diagnostic('PROFILE_MATERIALIZATION_FAILED', 'MATERIALIZE', `Official Harness deploy exited with code ${code}`, {
    component: 'pnpm deploy',
    action: 'Run the official Harness build/deploy checks and retry Package.',
  }))
}

/** Fill peer/vendor packages omitted by pnpm deploy's production peer closure. */
async function copyWorkspacePackageClosure(harnessRoot: string, deploymentRoot: string): Promise<string[]> {
  const sourceScope = join(harnessRoot, 'node_modules', '@deepseek-ai')
  const destinationScope = join(deploymentRoot, 'node_modules', '@deepseek-ai')
  await mkdir(destinationScope, { recursive: true })
  const copied: string[] = []
  for (const entry of await readdir(sourceScope, { withFileTypes: true })) {
    const source = join(sourceScope, entry.name)
    const destination = join(destinationScope, entry.name)
    if (existsSync(destination)) continue
    try {
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => !path.split('/').includes('node_modules'),
      })
      copied.push(`@deepseek-ai/${entry.name}`)
    } catch {
      // A platform-only or broken optional workspace link is not needed unless the official runtime imports it.
    }
  }
  const workspaceRoots = ['vendor', 'packages', 'apps', 'native']
  const packageRoots: Array<{ name: string; root: string }> = []
  const collect = async (root: string, depth: number): Promise<void> => {
    if (depth > 4) return
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'lib') continue
      const full = join(root, entry.name)
      if (entry.isDirectory()) await collect(full, depth + 1)
      else if (entry.isFile() && entry.name === 'package.json') {
        try {
          const manifest = JSON.parse(await readFile(full, 'utf8')) as { name?: unknown }
          if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) packageRoots.push({ name: manifest.name, root })
        } catch {
          // A non-package JSON file does not belong to the runtime closure.
        }
      }
    }
  }
  for (const root of workspaceRoots) await collect(join(harnessRoot, root), 0)
  for (const packageRoot of packageRoots) {
    const [scope, name] = packageRoot.name.split('/', 2)
    if (scope === undefined || name === undefined) continue
    const destination = join(deploymentRoot, 'node_modules', scope, name)
    if (existsSync(destination)) continue
    try {
      await cp(packageRoot.root, destination, {
        recursive: true,
        dereference: true,
        filter: path => !path.split('/').includes('node_modules'),
      })
      copied.push(packageRoot.name)
    } catch {
      // Optional platform workspaces are allowed to be absent until runtime asks for them.
    }
  }
  return [...new Set(copied)].sort()
}

function dynamicDependencies(path: string): string[] {
  const output = execFileSync('otool', ['-L', path], { encoding: 'utf8' })
  return output.split('\n').slice(1).map(line => line.trim().split(' ', 1)[0]).filter((value): value is string => value !== undefined && value.length > 0)
}

function rpathDirectories(path: string): string[] {
  const output = execFileSync('otool', ['-l', path], { encoding: 'utf8' })
  return [...output.matchAll(/path (\S+) \(offset/gu)].map(match => match[1]).filter((value): value is string => value !== undefined)
}

/** Make the embedded Node executable independent of the build host's Homebrew paths. */
async function bundleNodeRuntime(sourceNode: string, destinationNode: string, destinationLib: string): Promise<void> {
  await copyFile(sourceNode, destinationNode)
  await chmod(destinationNode, 0o755)
  await mkdir(destinationLib, { recursive: true })
  const pending = [destinationNode]
  const seen = new Set<string>()
  const sourceByDestination = new Map<string, string>([[destinationNode, sourceNode]])
  while (pending.length > 0) {
    const current = pending.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    const mainExecutable = current === destinationNode
    const relativePrefix = mainExecutable ? '@loader_path/lib/' : '@loader_path/'
    const sourceCurrent = sourceByDestination.get(current) ?? current
    for (const dependency of dynamicDependencies(current)) {
      if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/')) continue
      const name = basename(dependency)
      let source: string | undefined
      if (dependency.startsWith('@rpath/')) {
        const candidates = rpathDirectories(sourceCurrent).map(rpath => {
          const expanded = rpath
            .replace('@loader_path', dirname(sourceCurrent))
            .replace('@executable_path', dirname(sourceNode))
          return join(expanded, name)
        })
        if (mainExecutable) candidates.unshift(join(dirname(sourceNode), '..', 'lib', name))
        for (const candidate of candidates) {
          if (existsSync(candidate)) { source = candidate; break }
        }
      } else if (dependency.startsWith('@loader_path/')) {
        const candidate = join(dirname(sourceCurrent), dependency.slice('@loader_path/'.length))
        if (existsSync(candidate)) source = candidate
      } else if (dependency.startsWith('@executable_path/')) {
        const candidate = join(dirname(sourceNode), dependency.slice('@executable_path/'.length))
        if (existsSync(candidate)) source = candidate
      } else if (dependency.startsWith('/')) {
        source = await realpath(dependency)
      } else {
        continue
      }
      if (source === undefined || !existsSync(source)) throw new Error(`Unable to locate dynamic dependency ${dependency} for ${sourceCurrent}`)
      const destination = join(destinationLib, name)
      if (!existsSync(destination)) await copyFile(source, destination)
      const bundledReference = dependency.startsWith('@loader_path/') && !mainExecutable
        ? `@loader_path/${name}`
        : `${relativePrefix}${name}`
      execFileSync('install_name_tool', ['-change', dependency, bundledReference, current], { stdio: ['ignore', 'ignore', 'pipe'] })
      await chmod(destination, 0o755)
      sourceByDestination.set(destination, source)
      pending.push(destination)
    }
    if (mainExecutable) execFileSync('install_name_tool', ['-add_rpath', '@loader_path/lib', current], { stdio: ['ignore', 'ignore', 'pipe'] })
  }
}

async function signApp(appPath: string): Promise<void> {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], { stdio: ['ignore', 'ignore', 'pipe'] })
}

function receiptIsValid(receipt: VerificationReceipt, manifestId: string, integrity: IntegrityManifest): boolean {
  return receipt.schemaVersion === 1
    && receipt.stack.id === manifestId
    && receipt.stack.integrity === integrity.artifactHash
    && receipt.verification.level === 'runtime'
    && receipt.verification.result === 'pass'
    && receipt.verification.cacheUsed === false
}

/** Result of building one generic macOS Reference Client from a verified Stack. */
export interface PackageResult {
  appPath: string
  runtimeRoot: string
  copiedWorkspacePackages: string[]
  harnessVersion: string
  platform: { os: string; arch: string }
}

/** Package a verified Stack as a thin macOS shell over the official Harness runtime/UI. */
export async function packageStack(options: {
  stackRoot: string
  output: string
  harnessRoot?: string
  dshHome?: string
  cwd?: string
}): Promise<PackageResult> {
  const stack = await readStackManifest(options.stackRoot)
  const integrity = await verifyIntegrity(options.stackRoot)
  if (integrity.diagnostics.length > 0 || integrity.manifest === undefined) throw new DshStackError(integrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'STATIC_VERIFY', 'Stack integrity is invalid'))
  let receipt: VerificationReceipt
  try {
    receipt = JSON.parse(await readFile(join(options.stackRoot, 'verification.receipt.json'), 'utf8')) as VerificationReceipt
  } catch (error) {
    throw new DshStackError(diagnostic('VERIFICATION_INCOMPLETE', 'STATIC_VERIFY', `Runtime verification receipt is missing: ${String(error)}`, {
      action: 'Run dsh-stack verify <stack> and require a Runtime PASS before packaging.',
    }))
  }
  if (!receiptIsValid(receipt, stack.id, integrity.manifest)) throw new DshStackError(diagnostic('VERIFICATION_INCOMPLETE', 'STATIC_VERIFY', 'Stack does not have a current Runtime PASS receipt', {
    action: 'Run Runtime Verify again; a receipt for another Stack or a failed receipt cannot authorize Package.',
  }))
  const adapter = new SourceHarnessAdapter()
  const installation = await adapter.detectInstallation({ cwd: options.cwd, harnessRoot: options.harnessRoot, dshHome: options.dshHome })
  if (installation.mode !== 'source') throw new DshStackError(diagnostic('HARNESS_VERSION_UNAVAILABLE', 'MATERIALIZE', 'Package currently requires a source Harness checkout so the official runtime closure can be deployed', {
    action: 'Pass --harness to a checked-out official DeepSeek Harness release.',
  }), 2)
  if (installation.version !== stack.harness.version) throw new DshStackError(diagnostic('HARNESS_VERSION_MISMATCH', 'STATIC_VERIFY', `Stack requires Harness ${stack.harness.version}, found ${installation.version}`, {
    action: 'Use the exact Harness version named by the receipt and Stack.',
  }))
  const platform = currentPlatform()
  if (platform.os !== 'darwin' || !['x64', 'arm64'].includes(platform.arch)) throw new DshStackError(diagnostic('UNSUPPORTED_PLATFORM', 'MATERIALIZE', `macOS Reference Client is not supported on ${platform.os} ${platform.arch}`, {
    action: 'Package on macOS x64 or arm64.',
  }), 2)
  if (existsSync(options.output)) throw new DshStackError(diagnostic('INVALID_ARGUMENT', 'MATERIALIZE', `Package output already exists: ${options.output}`, {
    action: 'Choose a new output path; packaging never overwrites an existing client.',
  }), 3)
  const appPath = options.output
  const contents = join(appPath, 'Contents')
  const resources = join(contents, 'Resources')
  const macos = join(contents, 'MacOS')
  const harnessDestination = join(resources, 'harness')
  await mkdir(resources, { recursive: true })
  await mkdir(macos, { recursive: true })
  await runDeploy(installation.root, harnessDestination)
  const copiedWorkspacePackages = await copyWorkspacePackageClosure(installation.root, harnessDestination)
  await bundleNodeRuntime(process.execPath, join(resources, 'node'), join(resources, 'lib'))
  await cp(join(options.stackRoot, 'profile'), join(resources, 'profile'), { recursive: true })
  await copyFile(join(ASSET_ROOT, 'reference-client.mjs'), join(resources, 'reference-client.mjs'))
  await copyFile(join(ASSET_ROOT, 'Info.plist'), join(contents, 'Info.plist'))
  await copyFile(join(options.stackRoot, 'stack.yaml'), join(resources, 'stack.yaml'))
  await copyFile(join(options.stackRoot, 'stack.integrity.json'), join(resources, 'stack.integrity.json'))
  await copyFile(join(options.stackRoot, 'verification.receipt.json'), join(resources, 'verification.receipt.json'))
  await writeFile(join(resources, 'client.json'), JSON.stringify({ id: stack.id, profile: stack.harness.profile, secrets: stack.requirements.secrets }, null, 2) + '\n', 'utf8')
  const launcher = '#!/bin/sh\nset -eu\nCONTENTS=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$CONTENTS/Resources/node" "$CONTENTS/Resources/reference-client.mjs"\n'
  await writeFile(join(macos, 'dsh-stack-reference'), launcher, { encoding: 'utf8', mode: 0o755 })
  await chmod(join(macos, 'dsh-stack-reference'), 0o755)
  await signApp(appPath)
  return { appPath, runtimeRoot: harnessDestination, copiedWorkspacePackages, harnessVersion: installation.version, platform }
}
