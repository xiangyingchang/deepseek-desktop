import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  DshStackError,
  diagnostic,
  portableRelativePath,
  writeIntegrity,
  writeYaml,
  type HarnessInstallation,
  type IntegrityManifest,
  type PreflightResult,
  type ProfileInspection,
  type StackManifest,
} from './index.ts'
import { SourceHarnessAdapter, currentPlatform } from './source-adapter.ts'
import { distributionFromStack, writeDistributionManifest } from './distribution.ts'

async function copyInputs(inputs: ProfileInspection['inputs'], destination: string): Promise<void> {
  for (const input of inputs) {
    const target = join(destination, input.relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await copyFile(input.absolutePath, target)
  }
}

async function ensureOutputDirectory(path: string): Promise<void> {
  try {
    const entries = await readdir(path)
    if (entries.length > 0) throw new Error(`output directory is not empty: ${path}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path, { recursive: true })
  }
}

function externalSecretNames(profile: ProfileInspection): string[] {
  const dsh = profile.manifest?.dsh
  const profileSection = dsh !== null && typeof dsh === 'object' && dsh !== undefined
    ? (dsh as Record<string, unknown>).profile
    : undefined
  const bundles = profileSection !== null && typeof profileSection === 'object' && profileSection !== undefined
    ? (profileSection as Record<string, unknown>).bundles
    : undefined
  const names = Array.isArray(bundles) && bundles.some(bundle => bundle === '@deepseek-ai/dsh-base' || bundle === '@deepseek-ai/dsh-web-app')
    ? ['DEEPSEEK_API_KEY']
    : []
  return names
}

function throwPreflightFailure(preflight: PreflightResult, force: boolean): void {
  const secret = preflight.diagnostics.find(item => item.code === 'SECRET_DETECTED')
  if (secret !== undefined) throw new DshStackError(secret)
  const missingProfile = preflight.diagnostics.find(item => item.code === 'PROFILE_NOT_FOUND')
  if (missingProfile !== undefined) throw new DshStackError(missingProfile)
  if (preflight.status === 'CONSISTENT') return
  if (force) return
  const first = preflight.diagnostics[0] ?? diagnostic('PROFILE_STATE_INCONSISTENT', 'PREFLIGHT', 'Profile preflight did not reach CONSISTENT', {
    action: 'Inspect the Profile and fix the reported state before freezing.',
  })
  throw new DshStackError(first)
}

/** The output of a successful Freeze. */
export interface FreezeResult {
  installation: HarnessInstallation
  inspection: ProfileInspection
  preflight: PreflightResult
  manifest: StackManifest
  distribution: import('./types.ts').DistributionManifest
  integrity: IntegrityManifest
  output: string
}

/** Freeze a real Profile using the adapter's selected Profile-owned inputs. */
export async function freezeProfile(options: {
  profile: string
  output: string
  harnessRoot?: string
  dshHome?: string
  cwd?: string
  force?: boolean
  base?: import('./types.ts').DistributionManifest['base']
  storageId?: string
  distributionKind?: import('./types.ts').DistributionManifest['kind']
  distributionChannel?: import('./types.ts').DistributionManifest['channel']
}): Promise<FreezeResult> {
  const adapter = new SourceHarnessAdapter()
  let installation: HarnessInstallation
  try {
    installation = await adapter.detectInstallation({ cwd: options.cwd, harnessRoot: options.harnessRoot, dshHome: options.dshHome })
  } catch (error) {
    throw new DshStackError(diagnostic('HARNESS_NOT_FOUND', 'INSPECT', String(error), {
      action: 'Pass --harness <DeepSeek Harness checkout> or set DSH_HARNESS_ROOT.',
    }), 2)
  }
  const inspection = await adapter.inspectProfile(installation, options.profile, { dshHome: options.dshHome })
  const preflight = await adapter.preflight(inspection)
  throwPreflightFailure(preflight, options.force === true)
  const output = options.output
  await ensureOutputDirectory(output)
  const profileDir = join(output, 'profile')
  const testsDir = join(output, 'tests')
  await mkdir(profileDir, { recursive: true })
  await mkdir(testsDir, { recursive: true })
  await copyInputs(inspection.inputs, profileDir)
  const platformInfo = currentPlatform()
  const manifest: StackManifest = {
    schemaVersion: 1,
    id: `dsh-${inspection.name}`,
    name: `DeepSeek Harness ${inspection.name} Profile`,
    version: '0.1.0',
    description: 'A reproducible DeepSeek Harness Profile captured by DSH Stack.',
    harness: { version: installation.version, adapter: adapter.id, profile: inspection.name },
    profile: {
      source: './profile',
      inputs: inspection.inputs.map(input => portableRelativePath(input.relativePath)).sort(),
    },
    environment: {
      node: { ...(installation.nodeRequirement === undefined ? {} : { required: installation.nodeRequirement }), observed: installation.observedNode },
      pnpm: { ...(installation.packageManagerRequirement === undefined ? {} : { required: installation.packageManagerRequirement }), observed: installation.observedPackageManager },
      platform: { os: [platformInfo.os], arch: [platformInfo.arch] },
    },
    requirements: { secrets: externalSecretNames(inspection) },
    source: { consistency: preflight.status === 'CONSISTENT' ? 'verified' : 'unverified' },
    verification: { tests: ['./tests/smoke.yaml'] },
  }
  await writeFile(join(output, 'stack.yaml'), writeYaml(manifest), 'utf8')
  const distribution = distributionFromStack(manifest, {
    base: options.base,
    storageId: options.storageId,
    kind: options.distributionKind ?? (options.base === undefined ? 'base' : 'derived'),
    channel: options.distributionChannel ?? (options.base === undefined ? 'rc' : 'working'),
  })
  await writeDistributionManifest(output, distribution)
  await writeFile(join(testsDir, 'smoke.yaml'), writeYaml({
    mode: 'runtime',
    tests: [
      { name: 'official Harness Web UI responds', type: 'runtime.health' },
      { name: 'generated Profile root is materialized', type: 'profile.generated-root' },
      { name: 'no LLM request is required', type: 'runtime.no-live-llm' },
    ],
  }), 'utf8')
  const integrity = await writeIntegrity(output)
  return { installation, inspection, preflight, manifest, distribution, integrity, output }
}
