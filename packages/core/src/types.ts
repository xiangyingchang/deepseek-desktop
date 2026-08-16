/** A stage in the Freeze → Verify → Reproduce pipeline. */
export type Stage =
  | 'INSPECT'
  | 'PREFLIGHT'
  | 'FREEZE'
  | 'DRIFT'
  | 'REBASE'
  | 'STATIC_VERIFY'
  | 'MATERIALIZE'
  | 'INSTALL'
  | 'BOOT'
  | 'ACTIVATE'
  | 'CORE_TEST'
  | 'LIVE_TEST'
  | 'PACK'
  | 'SWITCH'
  | 'UPDATE_CHECK'
  | 'UPSTREAM_VERIFY'

/** The result vocabulary written to verification receipts. */
export type VerificationResult = 'pass' | 'fail' | 'unsupported' | 'incomplete'

/** Verification depth. `live` is reserved in V0.1 and never silently downgraded. */
export type VerificationLevel = 'static' | 'runtime' | 'live'

/** Stable process exit codes documented by the public CLI. */
export const EXIT_CODES = {
  success: 0,
  failure: 1,
  unsupported: 2,
  invalidInput: 3,
  internalError: 4,
} as const

/** Machine-readable error taxonomy. */
export type ErrorCode =
  | 'STACK_SCHEMA_ERROR'
  | 'STACK_INTEGRITY_ERROR'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_MANIFEST_ERROR'
  | 'PROFILE_STATE_INCONSISTENT'
  | 'LOCKFILE_MISSING'
  | 'LOCKFILE_MISMATCH'
  | 'NON_PORTABLE_DEPENDENCY'
  | 'SECRET_DETECTED'
  | 'HARNESS_NOT_FOUND'
  | 'HARNESS_VERSION_UNAVAILABLE'
  | 'HARNESS_VERSION_MISMATCH'
  | 'UNSUPPORTED_PLATFORM'
  | 'PACKAGE_BUILD_FAILED'
  | 'FROZEN_INSTALL_FAILED'
  | 'PROFILE_MATERIALIZATION_FAILED'
  | 'CORDIS_CONFIGURATION_ERROR'
  | 'PLUGIN_ACTIVATION_FAILED'
  | 'HARNESS_BOOT_FAILED'
  | 'CAPABILITY_MISSING'
  | 'SMOKE_TEST_FAILED'
  | 'LIVE_VERIFICATION_UNSUPPORTED'
  | 'VERIFICATION_INCOMPLETE'
  | 'DISTRIBUTION_SCHEMA_ERROR'
  | 'UPDATE_REBASE_CONFLICT'
  | 'ATOMIC_SWITCH_FAILED'
  | 'UPDATE_MANIFEST_INVALID'
  | 'UPDATE_ASSET_MISSING'
  | 'UPDATE_LOCKED'
  | 'UPDATE_RECOVERY_FAILED'
  | 'USER_STATE_CHANGED_DURING_UPDATE'
  | 'SHARE_ARTIFACT_ERROR'
  | 'USER_STATE_LEAK'
  | 'UPSTREAM_CANDIDATE_UNVERIFIED'
  | 'INVALID_ARGUMENT'
  | 'INTERNAL_ERROR'

/** One actionable diagnostic. Values are sanitized before being printed or persisted. */
export interface Diagnostic {
  code: ErrorCode
  stage: Stage
  message: string
  component?: string
  action?: string
  details?: Record<string, string | number | boolean | null>
}

/** An observed stage transition used by human output and receipts. */
export interface StageEvent {
  stage: Stage
  status: 'started' | 'passed' | 'failed' | 'skipped'
  at: string
  message?: string
}

/** Version and launch facts obtained from the real Harness installation. */
export interface HarnessInstallation {
  mode: 'source' | 'installed'
  root: string
  cliPackagePath?: string
  version: string
  rootVersion?: string
  nodeRequirement?: string
  packageManagerRequirement?: string
  observedNode: string
  observedPackageManager: string
  cliCommand: readonly string[]
  cliCwd: string
  gitCommit?: string
  gitDirty?: boolean
  web: {
    command: readonly string[]
    defaultHost: string
    defaultPort: number
    url: string
    official: true
  }
}

/** One Profile input selected by the version-specific Harness adapter. */
export interface ProfileInput {
  relativePath: string
  absolutePath: string
  kind: 'manifest' | 'workspace' | 'lockfile' | 'patch' | 'configuration'
}

/** A resolved bundle as understood by the official Harness installation. */
export interface BundleInspection {
  name: string
  packageDir?: string
  packageVersion?: string
  patchPath?: string
  patchReferences?: string[]
  entryPath?: string
  entryExists?: boolean
  lifecycleScripts?: string[]
  resolved: boolean
  hasBundleDeclaration: boolean
}

/** Read-only inspection of one Profile. */
export interface ProfileInspection {
  name: string
  home: string
  directory: string
  exists: boolean
  manifestPath: string
  manifest?: Record<string, unknown>
  inputs: ProfileInput[]
  generatedFiles: string[]
  excludedEntries: string[]
  missingExpectedInputs: string[]
  bundles: BundleInspection[]
  danglingReferences?: string[]
  profileNodeModulesPresent: boolean
  fallbackNodeModulesPresent: boolean
}

/** Result of consistency and portability checks before Freeze. */
export interface PreflightResult {
  status: 'CONSISTENT' | 'INCONSISTENT' | 'UNKNOWN'
  diagnostics: Diagnostic[]
  warnings: Diagnostic[]
  portability: {
    dependencyCount: number
    nonPortable: string[]
  }
  secretNames: string[]
}

/** A verified Stack manifest as represented in `stack.yaml`. */
export interface StackManifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  description: string
  harness: {
    version: string
    adapter: string
    profile: string
  }
  profile: {
    source: './profile'
    inputs: string[]
  }
  environment: {
    node: { required?: string; observed: string }
    pnpm: { required?: string; observed: string }
    platform: { os: string[]; arch: string[] }
  }
  requirements: { secrets: string[] }
  source: { consistency: 'verified' | 'unverified' }
  verification: { tests: ['./tests/smoke.yaml'] }
}

/** Release metadata only; Profile composition never belongs here. */
export interface DistributionManifest {
  schemaVersion: 1
  kind: 'base' | 'derived' | 'candidate'
  id: string
  version: string
  channel: 'stable' | 'rc' | 'working'
  /** Stable User State directory identity; never derive this from Base integrity. */
  storageId?: string
  harness: {
    version: string
    adapter: string
    profile: string
  }
  profile: { source: './profile' }
  base?: {
    id: string
    version: string
    integrity: string
  }
  release: {
    createdAt: string
    createdBy: 'dsh-stack'
  }
}

/** Release metadata consumed by an App updater; never a Profile manifest. */
export interface DistributionUpdateManifest {
  schemaVersion: 1
  distributionId: string
  channel: 'stable' | 'rc'
  appVersion: string
  baseVersion: string
  baseIntegrity: string
  harnessVersion: string
  minimumMacOS: string
  assets: DistributionUpdateAsset[]
  releaseNotesUrl?: string
  publishedAt?: string
}

export interface DistributionUpdateAsset {
  arch: 'x64' | 'arm64'
  url: string
  sha256: string
  bytes?: number
  receiptUrl?: string
}

/** SHA-256 manifest for a Stack artifact, excluding itself and receipts. */
export interface IntegrityManifest {
  schemaVersion: 1
  algorithm: 'sha256'
  files: Record<string, string>
  artifactHash: string
}

/** A check recorded in a verification receipt. */
export interface VerificationCheck {
  name: string
  type: string
  stage: Stage
  result: 'pass' | 'fail' | 'unsupported' | 'skipped'
  message: string
}

/** Machine-readable proof of one exact Stack verification attempt. */
export interface VerificationReceipt {
  schemaVersion: 1
  stack: {
    id: string
    version: string
    integrity: string
  }
  verification: {
    level: VerificationLevel
    result: VerificationResult
    startedAt: string
    finishedAt: string
    cacheUsed: false
  }
  environment: {
    os: string
    arch: string
    node: string
    pnpm: string
    clean: boolean
  }
  harness: {
    version: string
    mode: 'source' | 'installed'
    commit?: string
  }
  profile: {
    name: string
    generatedFiles: string[]
  }
  /** Optional lifecycle identity; when absent this is a legacy Stack receipt. */
  distribution?: {
    kind: DistributionManifest['kind']
    storageId?: string
    base?: DistributionManifest['base']
  }
  thirdPartyCodeExecuted: boolean
  externalServices: { llm: false; network: string[] }
  stages: StageEvent[]
  checks: VerificationCheck[]
  diagnostics: Diagnostic[]
}

/** A result handed directly from the real Verify call to a gated operation. */
export interface VerificationRun {
  receipt: VerificationReceipt
  receiptPath: string
  exitCode: 0 | 1 | 2
}

/** Options common to adapter operations. */
export interface AdapterOptions {
  cwd?: string
  harnessRoot?: string
  dshHome?: string
}

/** Harness-specific knowledge used by Stack inspection and preflight. */
export interface HarnessAdapter {
  readonly id: string
  detectInstallation(options?: AdapterOptions): Promise<HarnessInstallation>
  inspectProfile(installation: HarnessInstallation, profileName: string, options?: AdapterOptions): Promise<ProfileInspection>
  preflight(inspection: ProfileInspection): Promise<PreflightResult>
}
