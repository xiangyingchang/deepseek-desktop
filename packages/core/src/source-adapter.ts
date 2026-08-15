import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { platform, arch, homedir } from 'node:os'
import {
  absolutePath,
  diagnostic,
  detectSecretIndicators,
  profileDirectory,
  readSafeYaml,
  type AdapterOptions,
  type BundleInspection,
  type Diagnostic,
  type HarnessInstallation,
  type HarnessAdapter,
  type PreflightResult,
  type ProfileInput,
  type ProfileInspection,
} from './index.ts'

interface JsonObject {
  [key: string]: unknown
}

const GENERATED_FILES = new Set(['cordis.yml'])
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.dsh',
  'node_modules',
  '.cache',
  'cache',
  'coverage',
  'dist',
  'build',
  'sessions',
  'logs',
  'tmp',
])
const EXCLUDED_FILES = new Set(['.credentials.yaml', 'credentials.yaml'])
const EXPECTED_FILES = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml'])
const LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare'])
const DUPLICATE_RUNTIME_PACKAGES = new Set([
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-cli',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/cordis',
])

function objectValue(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

async function readJson(path: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  const value = objectValue(parsed)
  if (value === undefined) throw new Error(`${path} must contain a JSON object`)
  return value
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function packageEntry(manifest: JsonObject): string | undefined {
  const main = stringValue(manifest.main)
  if (main !== undefined) return main
  const exportsValue = manifest.exports
  if (typeof exportsValue === 'string') return exportsValue
  const exportsObject = objectValue(exportsValue)
  const root = objectValue(exportsObject?.['.']) ?? exportsObject
  return stringValue(root?.default)
}

function commandOutput(command: string, args: readonly string[], cwd: string): string | undefined {
  try {
    return execFileSync(command, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

function sourceRootLooksValid(root: string): boolean {
  return existsSync(join(root, 'package.json'))
    && existsSync(join(root, 'pnpm-workspace.yaml'))
    && existsSync(join(root, 'apps', 'cli', 'package.json'))
}

function discoverSourceRoot(options: AdapterOptions): string | undefined {
  const cwd = options.cwd ?? process.cwd()
  const candidates = [
    options.harnessRoot,
    process.env.DSH_HARNESS_ROOT,
    cwd,
    join(cwd, '..'),
    join(cwd, '..', 'deepseek-harness'),
    join(cwd, 'deepseek-harness'),
  ].filter((candidate): candidate is string => candidate !== undefined)
  for (const candidate of candidates) {
    const resolved = absolutePath(candidate, cwd)
    if (sourceRootLooksValid(resolved)) return resolved
  }
  return undefined
}

async function walkRegularFiles(root: string, current = root): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = join(current, entry.name)
    const relativePath = relative(root, full)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) output.push(...await walkRegularFiles(root, full))
      continue
    }
    if (entry.isFile() && !EXCLUDED_FILES.has(entry.name)) output.push(relativePath)
  }
  return output
}

function packageRootFromEntry(entryPath: string, packageName: string): string | undefined {
  let current = dirname(entryPath)
  while (current !== dirname(current)) {
    const manifestPath = join(current, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as JsonObject
        if (manifest.name === packageName) return current
      } catch {
        return undefined
      }
    }
    current = dirname(current)
  }
  return undefined
}

function resolvePackageRoot(packageName: string, anchors: readonly string[]): string | undefined {
  for (const anchor of anchors) {
    try {
      const requireFrom = createRequire(anchor.endsWith('package.json') ? anchor : join(anchor, 'package.json'))
      const entry = requireFrom.resolve(packageName)
      const root = packageRootFromEntry(entry, packageName)
      if (root !== undefined) return root
    } catch {
      // A bundle is identified by its package.json and dsh.bundle declaration;
      // it is valid for a configuration-only bundle to have no `main` entry.
      // Fall through to package-directory resolution instead of treating that
      // bundle as absent.
    }
    const packagePath = packageName.split('/')
    let current = anchor.endsWith('package.json') ? dirname(anchor) : anchor
    while (current !== dirname(current)) {
      const candidate = join(current, 'node_modules', ...packagePath)
      try {
        const root = realpathSync(candidate)
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as JsonObject
        if (manifest.name === packageName) return root
      } catch {
        // Try the next node_modules ancestor, matching Node's lookup boundary.
      }
      current = dirname(current)
    }
  }
  return undefined
}

function classifyInput(relativePath: string): ProfileInput['kind'] {
  if (relativePath === 'package.json') return 'manifest'
  if (relativePath === 'pnpm-workspace.yaml') return 'workspace'
  if (relativePath === 'pnpm-lock.yaml') return 'lockfile'
  if (relativePath === 'cordis.patch.yml') return 'patch'
  return 'configuration'
}

function dependencyMaps(manifest: JsonObject): Record<string, string> {
  const output: Record<string, string> = {}
  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    const values = objectValue(manifest[field])
    if (values === undefined) continue
    for (const [name, spec] of Object.entries(values)) if (typeof spec === 'string') output[name] = spec
  }
  return output
}

function bundleNames(manifest: JsonObject): string[] {
  const dsh = objectValue(manifest.dsh)
  const profile = objectValue(dsh?.profile)
  return stringArray(profile?.bundles)
}

function dependencyPortability(name: string, spec: string): string | undefined {
  if (spec.startsWith('link:')) return `${name}: link dependency ${spec}`
  if (spec.startsWith('workspace:')) return `${name}: workspace dependency ${spec}`
  if (spec.startsWith('file:') && (spec.startsWith('file:/') || spec.startsWith('file://'))) return `${name}: absolute file dependency ${spec}`
  if (spec.startsWith('file:')) return `${name}: file dependency requires vendor analysis ${spec}`
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:)/u.test(spec)) {
    const ref = spec.split('#', 2)[1]
    if (ref === undefined || !/^[0-9a-f]{40}$/iu.test(ref)) return `${name}: Git reference is not pinned to a commit SHA`
  }
  if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(spec)) return `${name}: absolute local dependency ${spec}`
  return undefined
}

function platformDependencyIssue(name: string): string | undefined {
  const value = name.toLowerCase()
  if (value.includes('darwin') && process.platform !== 'darwin') return `${name}: dependency targets darwin on ${process.platform}`
  if (value.includes('win32') && process.platform !== 'win32') return `${name}: dependency targets win32 on ${process.platform}`
  if (value.includes('linux') && process.platform !== 'linux') return `${name}: dependency targets linux on ${process.platform}`
  if (value.includes('arm64') && arch() !== 'arm64') return `${name}: dependency targets arm64 on ${arch()}`
  if (value.includes('x64') && arch() !== 'x64') return `${name}: dependency targets x64 on ${arch()}`
  return undefined
}

function collectPatchReferences(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPatchReferences(item, output)
    return
  }
  const object = objectValue(value)
  if (object === undefined) return
  const name = stringValue(object.name)
  if (name !== undefined) output.add(name)
  for (const item of Object.values(object)) collectPatchReferences(item, output)
}

async function readPatchReferences(path: string | undefined): Promise<string[]> {
  if (path === undefined) return []
  try {
    const source = await readFile(path, 'utf8')
    if (/!!js\b/u.test(source)) return []
    const value = await readSafeYaml(path)
    const references = new Set<string>()
    collectPatchReferences(value, references)
    return [...references].sort()
  } catch {
    return []
  }
}

function lockImporter(lock: unknown): JsonObject | undefined {
  const root = objectValue(lock)
  const importers = objectValue(root?.importers)
  const importer = objectValue(importers?.['.']) ?? objectValue(importers?.[''])
  if (importer === undefined) return undefined
  const flattened: JsonObject = {}
  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    const values = objectValue(importer[field])
    if (values !== undefined) Object.assign(flattened, values)
  }
  return flattened
}

/** Adapter for the current DeepSeek Harness source checkout and its official CLI. */
export class SourceHarnessAdapter implements HarnessAdapter {
  readonly id = 'deepseek-harness-source-v1'

  async detectInstallation(options: AdapterOptions = {}): Promise<HarnessInstallation> {
    const root = discoverSourceRoot(options)
    const cwd = options.cwd ?? process.cwd()
    if (root !== undefined) {
      const rootManifest = await readJson(join(root, 'package.json'))
      const cliPackagePath = join(root, 'apps', 'cli', 'package.json')
      const cliManifest = await readJson(cliPackagePath)
      const version = stringValue(cliManifest.version)
      if (version === undefined) throw new Error(`Harness CLI manifest has no version: ${cliPackagePath}`)
      const packageManagerRequirement = stringValue(rootManifest.packageManager)
      const nodeRequirement = stringValue(objectValue(rootManifest.engines)?.node)
      const observedPackageManager = commandOutput('pnpm', ['--version'], cwd) ?? 'unavailable'
      const observedNode = process.version
      const gitStatus = commandOutput('git', ['status', '--porcelain'], root)
      return {
        mode: 'source',
        root,
        cliPackagePath,
        version,
        rootVersion: stringValue(rootManifest.version),
        nodeRequirement,
        packageManagerRequirement,
        observedNode,
        observedPackageManager,
        cliCommand: ['pnpm', 'dsh'],
        cliCwd: root,
        gitCommit: commandOutput('git', ['rev-parse', 'HEAD'], root),
        gitDirty: gitStatus !== undefined && gitStatus !== '',
        web: {
          command: ['web'],
          defaultHost: '127.0.0.1',
          defaultPort: 3080,
          url: 'http://127.0.0.1:3080',
          official: true,
        },
      }
    }

    const dsh = commandOutput(process.platform === 'win32' ? 'where' : 'which', ['dsh'], cwd)
    if (dsh !== undefined && dsh.length > 0) {
      const version = commandOutput(dsh.split(/\r?\n/u)[0] ?? dsh, ['--version'], cwd)
      if (version !== undefined && version.length > 0) {
        return {
          mode: 'installed',
          root: dirname(dsh),
          version,
          observedNode: process.version,
          observedPackageManager: commandOutput('pnpm', ['--version'], cwd) ?? 'unavailable',
          cliCommand: [dsh],
          cliCwd: cwd,
          web: {
            command: ['web'],
            defaultHost: '127.0.0.1',
            defaultPort: 3080,
            url: 'http://127.0.0.1:3080',
            official: true,
          },
        }
      }
    }
    throw new Error('DeepSeek Harness not found; pass --harness <checkout> or set DSH_HARNESS_ROOT')
  }

  async inspectProfile(installation: HarnessInstallation, profileName: string, options: AdapterOptions = {}): Promise<ProfileInspection> {
    const home = absolutePath(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
    const directory = profileDirectory(home, profileName)
    const manifestPath = join(directory, 'package.json')
    if (!existsSync(directory) || !existsSync(manifestPath)) {
      return {
        name: profileName,
        home,
        directory,
        exists: false,
        manifestPath,
        inputs: [],
        generatedFiles: [],
        excludedEntries: [],
        missingExpectedInputs: [...EXPECTED_FILES],
        bundles: [],
        profileNodeModulesPresent: existsSync(join(directory, 'node_modules')),
        fallbackNodeModulesPresent: existsSync(join(home, 'profiles', 'node_modules')),
      }
    }
    const manifest = await readJson(manifestPath)
    const fileNames = await walkRegularFiles(directory)
    const generatedFiles = fileNames.filter(file => GENERATED_FILES.has(file))
    const inputs = fileNames
      .filter(file => !GENERATED_FILES.has(file))
      .map(relativePath => ({
        relativePath,
        absolutePath: join(directory, relativePath),
        kind: classifyInput(relativePath),
      }))
    const bundleList = bundleNames(manifest)
    const anchors = installation.cliPackagePath === undefined
      ? [directory]
      : [installation.cliPackagePath, directory]
    const bundles: BundleInspection[] = []
    for (const name of bundleList) {
      const packageDir = resolvePackageRoot(name, anchors)
      if (packageDir === undefined) {
        bundles.push({ name, resolved: false, hasBundleDeclaration: false })
        continue
      }
      const bundleManifest = await readJson(join(packageDir, 'package.json'))
      const dsh = objectValue(bundleManifest.dsh)
      const bundle = objectValue(dsh?.bundle)
      const patch = stringValue(bundle?.patch)
      const patchPath = patch === undefined ? undefined : join(packageDir, patch)
      const scripts = objectValue(bundleManifest.scripts)
      const lifecycleScripts = scripts === undefined
        ? []
        : Object.keys(scripts).filter(name => LIFECYCLE_SCRIPTS.has(name)).sort()
      const main = packageEntry(bundleManifest)
      bundles.push({
        name,
        packageDir,
        packageVersion: stringValue(bundleManifest.version),
        patchPath,
        patchReferences: await readPatchReferences(patchPath),
        ...(main === undefined ? {} : { entryPath: join(packageDir, main), entryExists: existsSync(join(packageDir, main)) }),
        lifecycleScripts,
        resolved: true,
        hasBundleDeclaration: patch !== undefined,
      })
    }
    const danglingReferences = new Set<string>()
    const profilePatch = fileNames.includes('cordis.patch.yml') ? join(directory, 'cordis.patch.yml') : undefined
    const patchPaths = [profilePatch, ...bundles.map(bundle => bundle.patchPath)].filter((path): path is string => path !== undefined)
    for (const patchPath of patchPaths) {
      for (const reference of await readPatchReferences(patchPath)) {
        if (resolvePackageRoot(reference, anchors) === undefined) danglingReferences.add(reference)
      }
    }
    return {
      name: profileName,
      home,
      directory,
      exists: true,
      manifestPath,
      manifest,
      inputs,
      generatedFiles,
      excludedEntries: ['node_modules', ...fileNames.filter(file => file.startsWith('node_modules/'))],
      missingExpectedInputs: [...EXPECTED_FILES].filter(file => !fileNames.includes(file)),
      bundles,
      danglingReferences: [...danglingReferences].sort(),
      profileNodeModulesPresent: existsSync(join(directory, 'node_modules')),
      fallbackNodeModulesPresent: existsSync(join(home, 'profiles', 'node_modules')),
    }
  }

  async preflight(inspection: ProfileInspection): Promise<PreflightResult> {
    const diagnostics: Diagnostic[] = []
    const warnings: Diagnostic[] = []
    if (!inspection.exists || inspection.manifest === undefined) {
      diagnostics.push(diagnostic('PROFILE_NOT_FOUND', 'PREFLIGHT', `Profile ${JSON.stringify(inspection.name)} was not found at ${inspection.directory}`, {
        action: 'Create the profile with the official dsh CLI, then inspect it again.',
      }))
      return { status: 'INCONSISTENT', diagnostics, warnings, portability: { dependencyCount: 0, nonPortable: [] }, secretNames: [] }
    }
    const dependencies = dependencyMaps(inspection.manifest)
    const lockInput = inspection.inputs.find(input => input.relativePath === 'pnpm-lock.yaml')
    if (Object.keys(dependencies).length > 0 && lockInput === undefined) {
      diagnostics.push(diagnostic('LOCKFILE_MISSING', 'PREFLIGHT', 'Profile declares external dependencies but has no pnpm-lock.yaml', {
        action: 'Run the official profile package manager to produce a lockfile before freezing.',
      }))
    }
    if (lockInput !== undefined) {
      try {
        const lock = await readSafeYaml(lockInput.absolutePath)
        const importer = lockImporter(lock)
        if (importer === undefined) {
          diagnostics.push(diagnostic('LOCKFILE_MISMATCH', 'PREFLIGHT', 'pnpm-lock.yaml has no root importer for the Profile', {
            component: lockInput.relativePath,
            action: 'Regenerate the lockfile with the official pnpm version for this Profile.',
          }))
        } else {
          for (const name of Object.keys(dependencies)) {
            if (!(name in importer)) {
              diagnostics.push(diagnostic('LOCKFILE_MISMATCH', 'PREFLIGHT', `Lockfile importer does not contain ${name}`, {
                component: lockInput.relativePath,
                action: 'Regenerate the lockfile without changing the Profile manifest by hand.',
              }))
              continue
            }
            const lockEntry = objectValue(importer[name])
            const specifier = stringValue(lockEntry?.specifier)
            if (specifier !== undefined && specifier !== dependencies[name]) diagnostics.push(diagnostic('LOCKFILE_MISMATCH', 'PREFLIGHT', `Lockfile specifier for ${name} does not match package.json`, {
              component: lockInput.relativePath,
              action: 'Regenerate the lockfile with the official package manager and keep package.json unchanged.',
              details: { manifest: dependencies[name]!, lockfile: specifier },
            }))
          }
        }
      } catch (error) {
        diagnostics.push(diagnostic('LOCKFILE_MISMATCH', 'PREFLIGHT', `Unable to parse pnpm-lock.yaml: ${String(error)}`, {
          component: lockInput.relativePath,
          action: 'Regenerate the lockfile with the official pnpm version.',
        }))
      }
    }
    const nonPortable: string[] = []
    for (const [name, spec] of Object.entries(dependencies)) {
      const issue = dependencyPortability(name, spec)
      if (issue !== undefined) nonPortable.push(issue)
      const platformIssue = platformDependencyIssue(name)
      if (platformIssue !== undefined) diagnostics.push(diagnostic('UNSUPPORTED_PLATFORM', 'PREFLIGHT', platformIssue, {
        component: 'package.json',
        action: 'Use a Profile dependency closure built for the target platform, or declare the supported platform explicitly.',
      }))
    }
    if (nonPortable.length > 0) {
      diagnostics.push(diagnostic('NON_PORTABLE_DEPENDENCY', 'PREFLIGHT', 'Profile contains dependency sources that cannot be reproduced by V0.1', {
        component: 'package.json',
        action: 'Pin Git sources to commit SHAs or vendor local packages before freezing.',
        details: { sources: nonPortable.join('; ') },
      }))
    }
    const duplicateRuntimePackages = Object.keys(dependencies).filter(name => DUPLICATE_RUNTIME_PACKAGES.has(name))
    if (duplicateRuntimePackages.length > 0) diagnostics.push(diagnostic('PROFILE_STATE_INCONSISTENT', 'PREFLIGHT', 'Profile declares a second Harness/runtime package instead of using the official installation closure', {
      component: 'package.json',
      action: 'Remove the duplicate Harness/runtime dependency and keep only the Profile-owned bundle dependencies.',
      details: { packages: duplicateRuntimePackages.join(', ') },
    }))
    for (const bundle of inspection.bundles) {
      if (!bundle.resolved) diagnostics.push(diagnostic('PROFILE_STATE_INCONSISTENT', 'PREFLIGHT', `Profile bundle ${bundle.name} cannot be resolved by the official Harness installation`, {
        component: 'dsh.profile.bundles',
        action: 'Install the bundle through the official dsh plugin command, then re-run inspection.',
      }))
      else if (!bundle.hasBundleDeclaration) diagnostics.push(diagnostic('PROFILE_STATE_INCONSISTENT', 'PREFLIGHT', `Profile bundle ${bundle.name} has no dsh.bundle declaration`, {
        component: `${bundle.name}/package.json`,
        action: 'Use a bundle package that declares its official Cordis patch.',
      }))
      else if (bundle.patchPath !== undefined && !existsSync(bundle.patchPath)) diagnostics.push(diagnostic('CORDIS_CONFIGURATION_ERROR', 'PREFLIGHT', `Bundle patch is missing for ${bundle.name}`, {
        component: bundle.patchPath,
        action: 'Repair the installed Harness bundle before freezing.',
      }))
      const references = bundle.patchReferences ?? []
      if (references.includes(bundle.name) && bundle.entryPath !== undefined && bundle.entryExists === false) diagnostics.push(diagnostic('PACKAGE_BUILD_FAILED', 'PREFLIGHT', `Bundle ${bundle.name} declares entry ${bundle.entryPath}, but the entry is absent`, {
        component: bundle.name,
        action: 'Run the bundle’s documented build/prepare step before installing it, then regenerate the lockfile and inspect again.',
      }))
      if ((bundle.lifecycleScripts ?? []).length > 0) warnings.push(diagnostic('PROFILE_STATE_INCONSISTENT', 'PREFLIGHT', `Bundle ${bundle.name} has lifecycle scripts: ${(bundle.lifecycleScripts ?? []).join(', ')}`, {
        component: `${bundle.name}/package.json`,
        action: 'Confirm the frozen package manager policy can reproduce these scripts in a clean environment.',
      }))
    }
    if ((inspection.danglingReferences ?? []).length > 0) diagnostics.push(diagnostic('CORDIS_CONFIGURATION_ERROR', 'PREFLIGHT', 'Cordis patch references plugins that are not resolvable from the Harness or Profile closure', {
      component: 'cordis.patch.yml',
      action: 'Install the referenced official or Profile-owned bundle before freezing; do not replace it with a hidden fallback.',
      details: { references: inspection.danglingReferences!.join(', ') },
    }))
    const patch = inspection.inputs.find(input => input.relativePath === 'cordis.patch.yml')
    if (patch !== undefined) {
      try {
        const source = await readFile(patch.absolutePath, 'utf8')
        const nonCommentSource = source.split(/\r?\n/u).filter(line => {
          const trimmed = line.trim()
          return trimmed !== '' && !trimmed.startsWith('#')
        }).join('\n')
        if (/!!js\b/u.test(nonCommentSource)) {
          const firstMeaningfulLine = nonCommentSource.split(/\r?\n/u).map(line => line.trim()).find(line => line !== '')
          if (!firstMeaningfulLine?.startsWith('[') && !firstMeaningfulLine?.startsWith('-')) throw new Error('root must be a YAML array')
          warnings.push(diagnostic('CORDIS_CONFIGURATION_ERROR', 'PREFLIGHT', 'Cordis patch contains !!js expressions; static inspection preserved them without evaluation', {
            component: patch.relativePath,
            action: 'Review JavaScript expressions before allowing Runtime Verify to execute this Profile.',
          }))
        } else {
          const value = await readSafeYaml(patch.absolutePath)
          if (!Array.isArray(value)) throw new Error('root must be a YAML array')
        }
      } catch (error) {
        diagnostics.push(diagnostic('CORDIS_CONFIGURATION_ERROR', 'PREFLIGHT', `Profile Cordis patch is invalid: ${String(error)}`, {
          component: patch.relativePath,
          action: 'Repair the patch using the official Harness patch format; JavaScript tags are not evaluated by static inspection.',
        }))
      }
    }
    const secretNames: string[] = []
    for (const input of inspection.inputs) {
      const file = await stat(input.absolutePath)
      if (file.size > 5_000_000) {
        warnings.push(diagnostic('PROFILE_STATE_INCONSISTENT', 'PREFLIGHT', `Skipped secret scan for oversized input ${input.relativePath}`, {
          component: input.relativePath,
          action: 'Review this input manually before freezing.',
        }))
        continue
      }
      const contents = await readFile(input.absolutePath, 'utf8')
      const indicators = detectSecretIndicators(input.relativePath, contents)
      if (indicators.length > 0) {
        secretNames.push(...indicators)
        diagnostics.push(diagnostic('SECRET_DETECTED', 'PREFLIGHT', `Potential secret detected in ${input.relativePath}`, {
          component: input.relativePath,
          action: 'Remove the secret value and keep only the required secret name in Stack metadata.',
        }))
      }
    }
    return {
      status: diagnostics.length === 0 ? 'CONSISTENT' : 'INCONSISTENT',
      diagnostics,
      warnings,
      portability: { dependencyCount: Object.keys(dependencies).length, nonPortable },
      secretNames: [...new Set(secretNames)],
    }
  }
}

/** Return the platform names used by Stack metadata. */
export function currentPlatform(): { os: string; arch: string } {
  return { os: platform(), arch: arch() }
}
