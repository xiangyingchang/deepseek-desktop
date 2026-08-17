import { execFileSync, spawn } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, open, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DshStackError,
  diagnostic,
  readDistributionManifest,
  readStackManifest,
  stableStorageId,
  type HarnessInstallation,
  type VerificationRun,
} from './index.ts'
import { SourceHarnessAdapter, currentPlatform } from './source-adapter.ts'
import { StackMaterializer, type MaterializedEnvironment } from './materializer.ts'
import { createPackageSizeReport, writePackageSizeReport, type PackageSizeReport } from './package-size-report.ts'
import { verifyIntegrity } from './integrity.ts'
import { absolutePath } from './paths.ts'
import { readAndMatchVerifiedReceipt } from './receipt.ts'

export type MacArchitecture = 'x64' | 'arm64'

function binaryArchitectures(path: string): string[] {
  const output = execFileSync('lipo', ['-archs', path], { encoding: 'utf8' }).trim()
  return output.split(/\s+/u).filter(Boolean).map(value => value === 'x86_64' ? 'x64' : value)
}

const ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const APP_EXECUTABLE = 'deepseek-desktop'
const APP_ICON = 'DeepSeekDesktop.icns'

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

function packageTrace(message: string): void {
  if (process.env.DSH_STACK_TRACE === '1') console.error(`[dsh-stack package] ${message}`)
}

interface PackageManifest {
  name?: unknown
  dependencies?: unknown
  optionalDependencies?: unknown
  peerDependencies?: unknown
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function updateManifestUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('not HTTPS')
    return url.href
  } catch {
    throw new DshStackError(diagnostic('INVALID_ARGUMENT', 'MATERIALIZE', `Update Manifest URL must be HTTPS: ${value}`, {
      component: 'updateManifestURL',
      action: 'Pass an HTTPS URL or omit the update feed for a manually distributed RC.',
    }), 3)
  }
}

function dependencyNames(manifest: PackageManifest): string[] {
  const names = new Set<string>()
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const values = manifest[field]
    if (values === null || typeof values !== 'object' || Array.isArray(values)) continue
    for (const name of Object.keys(values as Record<string, unknown>)) names.add(name)
  }
  return [...names]
}

async function readPackageManifest(root: string): Promise<PackageManifest | undefined> {
  try {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageManifest
  } catch {
    return undefined
  }
}

async function installedPackageRoots(root: string): Promise<string[]> {
  const output = [root]
  const nodeModules = join(root, 'node_modules')
  let entries
  try {
    entries = await readdir(nodeModules, { withFileTypes: true })
  } catch {
    return output
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const entryRoot = join(nodeModules, entry.name)
    if (entry.name.startsWith('@')) {
      let scopedEntries
      try {
        scopedEntries = await readdir(entryRoot, { withFileTypes: true })
      } catch {
        continue
      }
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) output.push(join(entryRoot, scopedEntry.name))
      }
    } else output.push(entryRoot)
  }
  return output
}

async function workspacePackageRoots(harnessRoot: string): Promise<Map<string, string>> {
  const output = new Map<string, string>()
  const collect = async (root: string, depth: number): Promise<void> => {
    if (depth > 4) return
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'lib') continue
      const full = join(root, entry.name)
      if (entry.isDirectory()) await collect(full, depth + 1)
      else if (entry.isFile() && entry.name === 'package.json') {
        const manifest = await readPackageManifest(root)
        if (typeof manifest?.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) output.set(manifest.name, root)
      }
    }
  }
  for (const root of ['vendor', 'packages', 'apps', 'native']) await collect(join(harnessRoot, root), 0)
  return output
}

/** Fill only the official workspace packages required by the deployed dependency graph. */
async function copyWorkspacePackageClosure(harnessRoot: string, deploymentRoot: string): Promise<string[]> {
  const destinationScope = join(deploymentRoot, 'node_modules', '@deepseek-ai')
  await mkdir(destinationScope, { recursive: true })
  const sources = await workspacePackageRoots(harnessRoot)
  const sourceScope = join(harnessRoot, 'node_modules', '@deepseek-ai')
  try {
    for (const entry of await readdir(sourceScope, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const root = join(sourceScope, entry.name)
      const manifest = await readPackageManifest(root)
      if (typeof manifest?.name === 'string' && manifest.name.startsWith('@deepseek-ai/')) sources.set(manifest.name, root)
    }
  } catch {
    // The source checkout may not have root-level workspace links; the workspace map is authoritative.
  }

  const copied: string[] = []
  const queue = await installedPackageRoots(deploymentRoot)
  const visited = new Set<string>()
  while (queue.length > 0) {
    const packageRoot = queue.shift()!
    if (visited.has(packageRoot)) continue
    visited.add(packageRoot)
    const manifest = await readPackageManifest(packageRoot)
    if (manifest === undefined) continue
    for (const dependency of dependencyNames(manifest)) {
      if (!dependency.startsWith('@deepseek-ai/')) continue
      const name = dependency.slice('@deepseek-ai/'.length)
      const destination = join(destinationScope, name)
      if (existsSync(destination)) continue
      const source = sources.get(dependency)
      if (source === undefined) continue
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => !path.split('/').includes('node_modules'),
      })
      copied.push(dependency)
      queue.push(destination)
      packageTrace(`copied workspace dependency ${dependency}`)
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

interface SigningResult {
  mode: 'adhoc' | 'identity'
  identity: string
  hardenedRuntime: boolean
}

const MACHO_MAGICS = new Set([0xFEEDFACE, 0xFEEDFACF, 0xCAFEBABE, 0xBEBAFECA, 0xCEFAEDFE, 0xCFFAEDFE])

/** Detect a Mach-O image (thin or universal) by its magic number. */
async function isMachOFile(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(4)
    const { bytesRead } = await handle.read(buffer, 0, 4, 0)
    if (bytesRead < 4) return false
    return MACHO_MAGICS.has(buffer.readUInt32BE(0)) || MACHO_MAGICS.has(buffer.readUInt32LE(0))
  } finally {
    await handle.close()
  }
}

/**
 * Every Mach-O binary embedded in the bundle, including bare executables under
 * Resources/ and prebuilt libraries deep inside node_modules closures.
 * `codesign --deep` never touches those locations, so they must be enumerated
 * and signed explicitly.
 */
export async function listBundleMachOFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && await isMachOFile(path)) found.push(path)
    }
  }
  await walk(root)
  return found.sort()
}

function codesignFailureDetail(error: unknown): string {
  const stderr = (error as { stderr?: Buffer }).stderr
  const detail = stderr === undefined ? undefined : stderr.toString('utf8').trim()
  return detail !== undefined && detail.length > 0 ? detail : String(error)
}

/**
 * Verify the outer bundle seal and every embedded Mach-O individually.
 * `codesign --verify --deep` does not validate nested binaries in
 * non-standard locations, so each one is checked on its own.
 */
function verifyAppBundleSignatures(appPath: string, targets: string[]): void {
  const failures: string[] = []
  for (const target of targets) {
    try {
      execFileSync('codesign', ['--verify', '--strict', target], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      failures.push(`${target}: ${codesignFailureDetail(error)}`)
    }
  }
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (error) {
    failures.push(`${appPath}: ${codesignFailureDetail(error)}`)
  }
  if (failures.length > 0) throw new DshStackError(diagnostic('PACKAGE_BUILD_FAILED', 'MATERIALIZE', `App bundle signature verification failed (${failures.length} failure${failures.length === 1 ? '' : 's'}): ${failures.join('; ')}`, {
    component: 'codesign embedded Mach-O verification',
    action: 'Re-run Package from a clean Stack; report the failing binaries if the error persists.',
  }))
}

/**
 * Sign the App bundle from the inside out. Binaries copied from the build
 * host or from npm packages may carry stale signatures already invalidated by
 * `install_name_tool` edits; macOS AMFI rejects their invalid code pages at
 * load time and SIGKILLs the runtime (the v0.2.0-rc.8 arm64 startup failure).
 * Every embedded Mach-O is therefore re-signed explicitly, the outer bundle
 * is sealed last, and the result is verified before Package can succeed.
 */
export async function signApp(appPath: string, options: { identity?: string; hardenedRuntime?: boolean } = {}): Promise<SigningResult> {
  const identity = options.identity ?? process.env.DSH_STACK_CODESIGN_IDENTITY ?? '-'
  const hardenedRuntime = options.hardenedRuntime ?? identity !== '-'
  const args = ['--force', '--sign', identity]
  if (hardenedRuntime) args.push('--options', 'runtime')
  args.push(identity === '-' ? '--timestamp=none' : '--timestamp')
  const executable = join(appPath, 'Contents', 'MacOS', APP_EXECUTABLE)
  const nested = (await listBundleMachOFiles(appPath)).filter(path => path !== executable)
  for (const target of nested) {
    try {
      execFileSync('codesign', [...args, target], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      throw new DshStackError(diagnostic('PACKAGE_BUILD_FAILED', 'MATERIALIZE', `Unable to sign embedded binary ${target}: ${codesignFailureDetail(error)}`, {
        component: 'codesign nested Mach-O signing',
        action: 'Verify the embedded runtime binaries are intact Mach-O images and retry Package.',
      }))
    }
  }
  execFileSync('codesign', [...args, appPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  verifyAppBundleSignatures(appPath, [...nested, executable])
  return { mode: identity === '-' ? 'adhoc' : 'identity', identity, hardenedRuntime }
}

/** Compile the generic AppKit/WebKit shell that hosts the official Harness UI. */
function compileNativeShell(source: string, destination: string, arch: string): void {
  const swiftArch = arch === 'x64' ? 'x86_64' : arch
  const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim()
  try {
    execFileSync('swiftc', [
      '-O',
      '-sdk', sdk,
      '-target', `${swiftArch}-apple-macos12.0`,
      '-framework', 'AppKit',
      '-framework', 'Security',
      '-framework', 'WebKit',
      '-o', destination,
      source,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (error) {
    throw new DshStackError(diagnostic('PACKAGE_BUILD_FAILED', 'MATERIALIZE', `Native macOS shell compilation failed: ${String(error)}`, {
      component: 'swiftc AppKit/WebKit shell',
      action: 'Install the macOS Xcode Command Line Tools and retry Package.',
    }))
  }
}

/** Result of building one generic macOS Reference Client from a verified Stack. */
export interface PackageResult {
  appPath: string
  runtimeRoot: string
  copiedWorkspacePackages: string[]
  harnessVersion: string
  platform: { os: string; arch: string }
  signing: SigningResult
  appVersion: string
  sizeReport?: PackageSizeReport
  sizeReportPath?: string
}

/** Package a verified Stack as a macOS Native Shell over the official Harness runtime/UI. */
export async function packageStack(options: {
  stackRoot: string
  output: string
  harnessRoot?: string
  dshHome?: string
  cwd?: string
  arch?: MacArchitecture
  nodeRuntime?: string
  signingIdentity?: string
  hardenedRuntime?: boolean
  sizeReport?: boolean
  appVersion?: string
  updateManifestURL?: string
  updateChannel?: 'stable' | 'rc'
  verify: () => Promise<VerificationRun>
}): Promise<PackageResult> {
  const stack = await readStackManifest(options.stackRoot)
  const distribution = await readDistributionManifest(options.stackRoot)
  const appVersion = options.appVersion ?? stack.version
  const updateManifestURL = updateManifestUrl(options.updateManifestURL)
  const updateChannel = options.updateChannel ?? (distribution?.channel === 'stable' ? 'stable' : 'rc')
  const integrity = await verifyIntegrity(options.stackRoot)
  if (integrity.diagnostics.length > 0 || integrity.manifest === undefined) throw new DshStackError(integrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'STATIC_VERIFY', 'Stack integrity is invalid'))
  await readAndMatchVerifiedReceipt(options.stackRoot, await options.verify(), {
    id: stack.id,
    version: stack.version,
    integrity: integrity.manifest.artifactHash,
  }, 'STATIC_VERIFY')
  const adapter = new SourceHarnessAdapter()
  const installation = await adapter.detectInstallation({ cwd: options.cwd, harnessRoot: options.harnessRoot, dshHome: options.dshHome })
  if (installation.mode !== 'source') throw new DshStackError(diagnostic('HARNESS_VERSION_UNAVAILABLE', 'MATERIALIZE', 'Package currently requires a source Harness checkout so the official runtime closure can be deployed', {
    action: 'Pass --harness to a checked-out official DeepSeek Harness release.',
  }), 2)
  if (installation.version !== stack.harness.version) throw new DshStackError(diagnostic('HARNESS_VERSION_MISMATCH', 'STATIC_VERIFY', `Stack requires Harness ${stack.harness.version}, found ${installation.version}`, {
    action: 'Use the exact Harness version named by the receipt and Stack.',
  }))
  const hostPlatform = currentPlatform()
  const targetArch = options.arch ?? hostPlatform.arch
  if (hostPlatform.os !== 'darwin' || !['x64', 'arm64'].includes(hostPlatform.arch) || !['x64', 'arm64'].includes(targetArch)) throw new DshStackError(diagnostic('UNSUPPORTED_PLATFORM', 'MATERIALIZE', `macOS Reference Client is not supported on ${hostPlatform.os} ${hostPlatform.arch} → ${targetArch}`, {
    action: 'Package on macOS x64 or arm64.',
  }), 2)
  if (!stack.environment.platform.arch.includes(targetArch)) throw new DshStackError(diagnostic('UNSUPPORTED_PLATFORM', 'STATIC_VERIFY', `Stack does not declare target macOS ${targetArch}; it declares ${stack.environment.platform.arch.join(', ')}`, {
    action: `Run Freeze and Runtime Verify on a native ${targetArch} environment before packaging that architecture.`,
  }), 2)
  const nodeRuntime = absolutePath(options.nodeRuntime ?? process.execPath, options.cwd ?? process.cwd())
  if (hostPlatform.arch !== targetArch && options.nodeRuntime === undefined) throw new DshStackError(diagnostic('PACKAGE_BUILD_FAILED', 'MATERIALIZE', `Cross-architecture package requires an explicit ${targetArch} Node runtime`, {
    component: 'embedded Node runtime',
    action: `Pass --node-runtime <${targetArch} Node executable> or run Package on a native ${targetArch} host.`,
  }))
  if (!existsSync(nodeRuntime)) throw new DshStackError(diagnostic('PACKAGE_BUILD_FAILED', 'MATERIALIZE', `Node runtime does not exist: ${nodeRuntime}`, {
    component: 'embedded Node runtime',
    action: 'Pass a native Node executable matching the requested architecture.',
  }))
  let runtimeArchitectures: string[]
  try {
    runtimeArchitectures = binaryArchitectures(nodeRuntime)
  } catch (error) {
    throw new DshStackError(diagnostic('PACKAGE_BUILD_FAILED', 'MATERIALIZE', `Unable to inspect Node runtime architecture: ${String(error)}`, {
      component: 'lipo -archs',
      action: 'Pass a macOS Node executable or build on the target architecture.',
    }))
  }
  if (!runtimeArchitectures.includes(targetArch)) throw new DshStackError(diagnostic('PACKAGE_BUILD_FAILED', 'MATERIALIZE', `Node runtime does not contain target architecture ${targetArch}: ${runtimeArchitectures.join(', ')}`, {
    component: nodeRuntime,
    action: 'Pass a matching native Node runtime.',
  }))
  if (existsSync(options.output)) throw new DshStackError(diagnostic('INVALID_ARGUMENT', 'MATERIALIZE', `Package output already exists: ${options.output}`, {
    action: 'Choose a new output path; packaging never overwrites an existing client.',
  }), 3)
  const appPath = options.output
  const contents = join(appPath, 'Contents')
  const resources = join(contents, 'Resources')
  const macos = join(contents, 'MacOS')
  const harnessDestination = join(resources, 'harness')
  let materialized: MaterializedEnvironment | undefined
  try {
    packageTrace('materializing exact Profile dependency closure')
    materialized = await new StackMaterializer().materialize({ stackRoot: options.stackRoot, stack, installation })
    await mkdir(resources, { recursive: true })
    await mkdir(macos, { recursive: true })
    packageTrace('deploying official Harness production runtime')
    await runDeploy(installation.root, harnessDestination)
    packageTrace('resolving missing official workspace dependencies')
    const copiedWorkspacePackages = await copyWorkspacePackageClosure(installation.root, harnessDestination)
    packageTrace(`workspace dependency closure complete (${copiedWorkspacePackages.length} packages copied)`)
    packageTrace('embedding Node runtime and dynamic libraries')
    await bundleNodeRuntime(nodeRuntime, join(resources, 'node'), join(resources, 'lib'))
    packageTrace('copying Stack Profile, exact dependency closure, and receipt')
    await cp(materialized.profileDir, join(resources, 'profile'), { recursive: true, dereference: true })
    await copyFile(join(ASSET_ROOT, 'reference-client.mjs'), join(resources, 'reference-client.mjs'))
    await copyFile(join(ASSET_ROOT, 'profile-rebase.mjs'), join(resources, 'profile-rebase.mjs'))
    await copyFile(join(ASSET_ROOT, 'update-state.mjs'), join(resources, 'update-state.mjs'))
    await copyFile(join(ASSET_ROOT, 'app-updater.mjs'), join(resources, 'app-updater.mjs'))
    const infoTemplate = await readFile(join(ASSET_ROOT, 'Info.plist'), 'utf8')
    const shortVersion = xmlEscape(appVersion)
    const buildVersion = xmlEscape(appVersion.replace(/[^0-9.]/gu, '') || '0.0.0')
    const infoPlist = infoTemplate
      .replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/u, `$1${shortVersion}$2`)
      .replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/u, `$1${buildVersion}$2`)
    await writeFile(join(contents, 'Info.plist'), infoPlist, 'utf8')
    await copyFile(join(ASSET_ROOT, APP_ICON), join(resources, APP_ICON))
    await copyFile(join(options.stackRoot, 'stack.yaml'), join(resources, 'stack.yaml'))
    try { await copyFile(join(options.stackRoot, 'distribution.yaml'), join(resources, 'distribution.yaml')) } catch { /* legacy Stack */ }
    await copyFile(join(options.stackRoot, 'stack.integrity.json'), join(resources, 'stack.integrity.json'))
    await copyFile(join(options.stackRoot, 'verification.receipt.json'), join(resources, 'verification.receipt.json'))
    // The application data directory is keyed by the stable Distribution
    // identity, not by App/Base version or artifact hash. This id must remain
    // unchanged for the lifetime of one DeepSeek Desktop distribution line.
    const storageId = stableStorageId(distribution?.storageId ?? stack.id)
    await writeFile(join(resources, 'client.json'), JSON.stringify({
      id: stack.id,
      storageId,
      architecture: targetArch,
      appVersion,
      baseVersion: stack.version,
      baseIntegrity: integrity.manifest.artifactHash,
      updateChannel,
      ...(updateManifestURL === undefined ? {} : { updateManifestURL }),
      distributionKind: 'base',
      profile: stack.harness.profile,
      secrets: stack.requirements.secrets,
    }, null, 2) + '\n', 'utf8')
    packageTrace(`compiling ${targetArch} Native Shell`)
    compileNativeShell(join(ASSET_ROOT, 'ReferenceShell.swift'), join(macos, APP_EXECUTABLE), targetArch)
    await chmod(join(macos, APP_EXECUTABLE), 0o755)
    packageTrace('signing App bundle')
    const signing = await signApp(appPath, { identity: options.signingIdentity, hardenedRuntime: options.hardenedRuntime })
    const sizeReportPath = options.sizeReport === true
      ? join(dirname(appPath), `${basename(appPath, '.app')}-package-size-report.json`)
      : undefined
    const sizeReport = options.sizeReport === true
      ? await createPackageSizeReport({
        appPath,
        profile: stack.harness.profile,
        architecture: targetArch,
        baselineBytes: Number(process.env.DSH_STACK_SIZE_BASELINE_BYTES) || undefined,
      })
      : undefined
    if (sizeReport !== undefined && sizeReportPath !== undefined) await writePackageSizeReport(sizeReportPath, sizeReport)
    return {
      appPath,
      runtimeRoot: harnessDestination,
      copiedWorkspacePackages,
      harnessVersion: installation.version,
      appVersion,
      platform: { os: hostPlatform.os, arch: targetArch },
      signing,
      ...(sizeReport === undefined ? {} : { sizeReport }),
      ...(sizeReportPath === undefined ? {} : { sizeReportPath }),
    }
  } finally {
    if (materialized !== undefined) await materialized.cleanup().catch(() => {})
  }
}
