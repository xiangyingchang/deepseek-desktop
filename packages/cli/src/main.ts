#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  EXIT_CODES,
  DshStackError,
  SourceHarnessAdapter,
  absolutePath,
  freezeProfile,
  packageStack,
  detectProfileDrift,
  importShareableStack,
  packShareableStack,
  promoteDistribution,
  rebaseProfiles,
  rebaseStack,
  resolveProfileInput,
  verifyThenAtomicSwitch,
  writeRebaseReport,
  readDistributionManifest,
  readStackManifest,
  inspectHarnessUpgradeCandidate,
  verifyHarnessUpgrade,
  verifyIntegrity,
  runCleanStack,
  verifyStack,
  type Diagnostic,
  type ProfileInspection,
} from '@dsh-stack/core'

const VERSION = (() => {
  try {
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof root.version === 'string' ? root.version : '0.1.0'
  } catch {
    return '0.1.0'
  }
})()

export const HELP = `Usage: dsh-stack <command> [options]

Commands:
  inspect                 inspect a real Harness Profile without freezing it
  freeze                  preflight and capture a Profile into a Stack artifact
  verify <stack>          statically verify and reconstruct a Stack
  run <stack> --clean     reconstruct a Stack and keep the official Web UI open
  package <stack>         package a Runtime-PASS Stack as a macOS .app
  drift <base> <current>  detect Profile-owned changes without mutating either Profile
  rebase <old> <current> <new>  compute a three-way Profile rebase candidate
  promote <stack>         manually promote a verified Working Profile to a Base Candidate
  pack <stack>             create the default state-free .dshstack sharing artifact
  import <archive>        inspect and extract a .dshstack for standard verification
  update <old> <current> <new>  verify a rebased candidate, then atomically switch it
  upgrade-verify <stack> <harness>  verify a Stack against an explicit Harness candidate

Common options:
  --profile <name>        Profile name under DSH_HOME (default: web)
  --harness <path>        DeepSeek Harness source checkout
  --dsh-home <path>      Harness home (default: $DSH_HOME or ~/.dsh)
  --json                  emit machine-readable output
  --help                  show this help
  --version               show the DSH Stack version

Freeze options:
  --output <path>         artifact directory (default: ./artifacts/<profile>)
  --report <path>         machine-readable drift/rebase report
  --active <path>         active Profile directory for an update switch
  --distribution-version <version>  Candidate version for Promote
  --base <stack>          Base Stack identity for a newly frozen Derived Profile
  --force                 record an inconsistent source as unverified; never bypasses secret detection

Verify/run options:
  --host <host>           Web UI bind host (default: 127.0.0.1)
  --port <port>           Web UI port (default: an available local port)
  --keep-temp             keep the disposable environment for inspection
  --arch <x64|arm64>      target macOS architecture for Package (default: host)
  --node-runtime <path>   explicit target-architecture Node executable for Package
  --signing-identity <id> codesign identity; default is ad-hoc
  --hardened-runtime      enable Hardened Runtime when signing
  --size-report           write package-size-report.json next to the App
  --live                  reserved; returns UNSUPPORTED in V0.1
`

interface ParsedArgs {
  command: 'inspect' | 'freeze' | 'verify' | 'run' | 'package' | 'drift' | 'rebase' | 'promote' | 'pack' | 'import' | 'update' | 'upgrade-verify'
  profile: string
  harnessRoot?: string
  dshHome?: string
  output?: string
  stackRoot?: string
  operands: string[]
  json: boolean
  force: boolean
  clean: boolean
  live: boolean
  keepTemp: boolean
  host?: string
  port?: number
  arch?: 'x64' | 'arm64'
  nodeRuntime?: string
  signingIdentity?: string
  hardenedRuntime: boolean
  sizeReport: boolean
  report?: string
  activePath?: string
  baseStack?: string
  distributionVersion?: string
}

function optionValue(argv: readonly string[], index: number, flag: string): { value: string; next: number } {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `${flag} requires a value`, action: 'Pass a value after the option.' }, EXIT_CODES.invalidInput)
  return { value, next: index + 1 }
}

/** Parse the deliberately small CLI grammar before dispatching to the core pipeline. */
export function parseArgs(argv: readonly string[]): ParsedArgs | 'help' | 'version' {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return 'help'
  if (argv.includes('--version') || argv.includes('-V')) return 'version'
  const command = argv[0]
  const validCommands = ['inspect', 'freeze', 'verify', 'run', 'package', 'drift', 'rebase', 'promote', 'pack', 'import', 'update', 'upgrade-verify'] as const
  if (!validCommands.includes(command as typeof validCommands[number])) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `Unknown command ${JSON.stringify(command)}`, action: 'Run dsh-stack --help to see the supported commands.' }, EXIT_CODES.invalidInput)
  const parsed: ParsedArgs = { command: command as ParsedArgs['command'], profile: 'web', operands: [], json: false, force: false, clean: false, live: false, keepTemp: false, hardenedRuntime: false, sizeReport: false }
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!
    if (token === '--json') parsed.json = true
    else if (token === '--force') parsed.force = true
    else if (token === '--clean') parsed.clean = true
    else if (token === '--live') parsed.live = true
    else if (token === '--keep-temp') parsed.keepTemp = true
    else if (token === '--profile') {
      const item = optionValue(argv, index, token); parsed.profile = item.value; index = item.next
    } else if (token === '--harness') {
      const item = optionValue(argv, index, token); parsed.harnessRoot = item.value; index = item.next
    } else if (token === '--dsh-home') {
      const item = optionValue(argv, index, token); parsed.dshHome = item.value; index = item.next
    } else if (token === '--output') {
      const item = optionValue(argv, index, token); parsed.output = item.value; index = item.next
    } else if (token === '--report') {
      const item = optionValue(argv, index, token); parsed.report = item.value; index = item.next
    } else if (token === '--active') {
      const item = optionValue(argv, index, token); parsed.activePath = item.value; index = item.next
    } else if (token === '--base') {
      const item = optionValue(argv, index, token); parsed.baseStack = item.value; index = item.next
    } else if (token === '--distribution-version') {
      const item = optionValue(argv, index, token); parsed.distributionVersion = item.value; index = item.next
    } else if (token === '--host') {
      const item = optionValue(argv, index, token); parsed.host = item.value; index = item.next
    } else if (token === '--port') {
      const item = optionValue(argv, index, token); const port = Number(item.value)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `Invalid port ${item.value}`, action: 'Use an integer TCP port between 1 and 65535.' }, EXIT_CODES.invalidInput)
      parsed.port = port; index = item.next
    } else if (token === '--arch') {
      const item = optionValue(argv, index, token)
      if (item.value !== 'x64' && item.value !== 'arm64') throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `Invalid macOS architecture ${item.value}`, action: 'Use --arch x64 or --arch arm64.' }, EXIT_CODES.invalidInput)
      parsed.arch = item.value; index = item.next
    } else if (token === '--node-runtime') {
      const item = optionValue(argv, index, token); parsed.nodeRuntime = item.value; index = item.next
    } else if (token === '--signing-identity') {
      const item = optionValue(argv, index, token); parsed.signingIdentity = item.value; index = item.next
    } else if (token === '--hardened-runtime') parsed.hardenedRuntime = true
    else if (token === '--size-report') parsed.sizeReport = true
    else if (token.startsWith('--')) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `Unknown option ${token}`, action: 'Run dsh-stack --help to see the supported options.' }, EXIT_CODES.invalidInput)
    else parsed.operands.push(token)
  }
  parsed.stackRoot = parsed.operands[0]
  const commandName = command!
  const minimumOperands: Record<string, number> = { verify: 1, run: 1, package: 1, pack: 1, import: 1, promote: 1, drift: 2, rebase: 3, update: 3, 'upgrade-verify': 2 }
  const required = minimumOperands[commandName] ?? 0
  if (parsed.operands.length < required) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `${commandName} requires ${required} positional argument(s)`, action: `Run dsh-stack ${commandName} with the required paths.` }, EXIT_CODES.invalidInput)
  if (parsed.operands.length > (commandName === 'drift' || commandName === 'upgrade-verify' ? 2 : commandName === 'rebase' || commandName === 'update' ? 3 : commandName === 'inspect' || commandName === 'freeze' ? 1 : 1)) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `Unexpected argument ${parsed.operands[parsed.operands.length - 1]}`, action: 'Pass only the paths documented by dsh-stack --help.' }, EXIT_CODES.invalidInput)
  if (commandName === 'run' && !parsed.clean) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: 'run requires --clean', action: 'Use run <stack> --clean so the disposable materialization is explicit.' }, EXIT_CODES.invalidInput)
  if (commandName === 'update' && parsed.activePath === undefined) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: 'update requires --active <profile-directory>', action: 'Pass the current active Profile directory; it is never replaced before verification.' }, EXIT_CODES.invalidInput)
  return parsed
}

function displayDiagnostic(diagnostic: Diagnostic): string {
  const lines = [`${diagnostic.code} [${diagnostic.stage}]: ${diagnostic.message}`]
  if (diagnostic.component !== undefined) lines.push(`Component: ${diagnostic.component}`)
  if (diagnostic.action !== undefined) lines.push(`Action: ${diagnostic.action}`)
  return lines.join('\n')
}

function displayInspection(installation: Awaited<ReturnType<SourceHarnessAdapter['detectInstallation']>>, inspection: ProfileInspection, preflight: Awaited<ReturnType<SourceHarnessAdapter['preflight']>>): string {
  const lines = [
    `Harness: ${installation.version} (${installation.mode})`,
    `Harness root: ${installation.root}`,
    `CLI: ${installation.cliCommand.join(' ')} (cwd ${installation.cliCwd})`,
    `Package manager: required ${installation.packageManagerRequirement ?? 'unspecified'}, observed ${installation.observedPackageManager}`,
    `Profile: ${inspection.name}`,
    `Profile directory: ${inspection.directory}`,
    `Profile-owned inputs: ${inspection.inputs.length === 0 ? '(none)' : inspection.inputs.map(input => input.relativePath).join(', ')}`,
    `Generated by Harness: ${inspection.generatedFiles.length === 0 ? '(none observed)' : inspection.generatedFiles.join(', ')}`,
    `Bundles: ${inspection.bundles.length === 0 ? '(none)' : inspection.bundles.map(bundle => `${bundle.name}=${bundle.resolved && bundle.hasBundleDeclaration ? 'resolved' : 'invalid'}`).join(', ')}`,
    `Preflight: ${preflight.status}`,
    `Official Web UI: ${installation.cliCommand.join(' ')} web → ${installation.web.url}`,
  ]
  for (const warning of preflight.warnings) lines.push(`Warning: ${displayDiagnostic(warning)}`)
  for (const failure of preflight.diagnostics) lines.push(displayDiagnostic(failure))
  return lines.join('\n')
}

async function inspectCommand(args: ParsedArgs): Promise<number> {
  const adapter = new SourceHarnessAdapter()
  const installation = await adapter.detectInstallation({ cwd: process.cwd(), harnessRoot: args.harnessRoot, dshHome: args.dshHome })
  const inspection = await adapter.inspectProfile(installation, args.profile, { dshHome: args.dshHome })
  const preflight = await adapter.preflight(inspection)
  if (args.json) console.log(JSON.stringify({ installation, inspection, preflight }, null, 2))
  else console.log(displayInspection(installation, inspection, preflight))
  return preflight.status === 'CONSISTENT' ? EXIT_CODES.success : EXIT_CODES.failure
}

async function profileArgument(value: string): Promise<string> {
  return resolveProfileInput(absolutePath(value))
}

async function driftCommand(args: ParsedArgs): Promise<number> {
  const report = await detectProfileDrift(await profileArgument(args.operands[0]!), await profileArgument(args.operands[1]!))
  if (args.report !== undefined) {
    const path = absolutePath(args.report)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8')
  }
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else console.log(`DRIFT ${report.status}\nAdded: ${report.delta.added.length}\nRemoved: ${report.delta.removed.length}\nModified: ${report.delta.modified.length}`)
  return EXIT_CODES.success
}

async function rebaseCommand(args: ParsedArgs): Promise<number> {
  const output = absolutePath(args.output ?? './artifacts/rebase-candidate-profile')
  const report = await rebaseProfiles({
    oldBaseProfile: await profileArgument(args.operands[0]!),
    currentProfile: await profileArgument(args.operands[1]!),
    newBaseProfile: await profileArgument(args.operands[2]!),
    outputProfile: output,
  })
  await writeRebaseReport(absolutePath(args.report ?? `${output}.rebase-report.json`), report)
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else console.log(`REBASE ${report.status}\nCandidate: ${report.output ?? '(not written)'}\nUser Delta: +${report.delta.added.length} -${report.delta.removed.length} ~${report.delta.modified.length}${report.conflicts.length === 0 ? '' : `\nConflicts: ${report.conflicts.map(item => `${item.path} (${item.reason})`).join('; ')}`}`)
  if (report.status !== 'PASS') throw new DshStackError({ code: 'UPDATE_REBASE_CONFLICT', stage: 'REBASE', message: `Distribution Rebase found ${report.conflicts.length} conflict(s)`, action: 'Review the rebase report; the current Profile was not changed.' })
  return EXIT_CODES.success
}

async function baseReference(path: string): Promise<{ id: string; version: string; integrity: string }> {
  const root = absolutePath(path)
  const stack = await readStackManifest(root)
  const integrity = await verifyIntegrity(root)
  if (integrity.diagnostics.length > 0 || integrity.manifest === undefined) throw new DshStackError(integrity.diagnostics[0] ?? { code: 'STACK_INTEGRITY_ERROR', stage: 'STATIC_VERIFY', message: 'Base Stack integrity is invalid', action: 'Verify the Base Stack before deriving from it.' })
  const distribution = await readDistributionManifest(root)
  return { id: distribution?.id ?? stack.id, version: distribution?.version ?? stack.version, integrity: integrity.manifest.artifactHash }
}

async function promoteCommand(args: ParsedArgs): Promise<number> {
  const source = absolutePath(args.operands[0]!)
  const output = absolutePath(args.output ?? `${source}-candidate`)
  const result = await promoteDistribution({ sourceStack: source, outputStack: output, version: args.distributionVersion })
  if (args.json) console.log(JSON.stringify(result, null, 2))
  else console.log(`PROMOTED\nCandidate: ${result.output}\nDistribution: ${result.manifest.kind} ${result.manifest.version}`)
  return EXIT_CODES.success
}

async function packCommand(args: ParsedArgs): Promise<number> {
  const stackRoot = absolutePath(args.operands[0]!)
  const output = absolutePath(args.output ?? `${stackRoot}.dshstack`)
  const result = await packShareableStack({ stackRoot, output })
  if (args.json) console.log(JSON.stringify(result, null, 2))
  else console.log(`PACKED\nShareable Stack: ${result.output}\nFiles: ${result.files.join(', ')}`)
  return EXIT_CODES.success
}

async function importCommand(args: ParsedArgs): Promise<number> {
  const archive = absolutePath(args.operands[0]!)
  const defaultName = basename(archive).replace(/\.dshstack$/u, '')
  const output = absolutePath(args.output ?? `./artifacts/imported-${defaultName}`)
  const result = await importShareableStack({ archive, output })
  if (args.json) console.log(JSON.stringify(result, null, 2))
  else console.log(`IMPORTED\nStack: ${result.output}\nNext: dsh-stack verify ${result.output}`)
  return EXIT_CODES.success
}

async function updateCommand(args: ParsedArgs): Promise<number> {
  const output = absolutePath(args.output ?? `./artifacts/update-candidate-${Date.now()}`)
  const reportPath = absolutePath(args.report ?? `${output}.rebase-report.json`)
  const result = await rebaseStack({
    oldBaseStack: absolutePath(args.operands[0]!),
    currentDerivedStack: absolutePath(args.operands[1]!),
    newBaseStack: absolutePath(args.operands[2]!),
    outputStack: output,
  })
  await writeRebaseReport(reportPath, result.report)
  if (result.report.status !== 'PASS' || result.candidateStack === undefined) throw new DshStackError({ code: 'UPDATE_REBASE_CONFLICT', stage: 'REBASE', message: `Update blocked: ${result.report.conflicts.length} Distribution Rebase conflict(s)`, action: `The active Profile was not changed. Review ${reportPath}.` })
  const verification = await verifyStack({ stackRoot: result.candidateStack, harnessRoot: args.harnessRoot, dshHome: args.dshHome, cwd: process.cwd(), keepTemp: args.keepTemp, host: args.host, port: args.port })
  if (verification.exitCode !== EXIT_CODES.success) throw new DshStackError(verification.receipt.diagnostics[0] ?? { code: 'VERIFICATION_INCOMPLETE', stage: 'SWITCH', message: `Candidate verification returned ${verification.receipt.verification.result.toUpperCase()}`, action: `The active Profile was not changed. Inspect ${verification.receiptPath}.` })
  const candidateProfile = join(result.candidateStack, 'profile')
  const switchCopy = `${absolutePath(args.activePath!)}.candidate-${Date.now()}`
  await cp(candidateProfile, switchCopy, { recursive: true, dereference: true })
  try {
    await verifyThenAtomicSwitch({
      candidateProfile: switchCopy,
      activeProfile: absolutePath(args.activePath!),
      verify: async () => ({ result: verification.receipt.verification.result }),
    })
  } finally {
    await rm(switchCopy, { recursive: true, force: true }).catch(() => {})
  }
  if (args.json) console.log(JSON.stringify({ report: result.report, receipt: verification.receipt, active: absolutePath(args.activePath!) }, null, 2))
  else console.log(`UPDATED\nActive Profile: ${absolutePath(args.activePath!)}\nCandidate Receipt: ${verification.receiptPath}\nOld Profile retained as: ${absolutePath(args.activePath!)}.previous`)
  return EXIT_CODES.success
}

async function upgradeVerifyCommand(args: ParsedArgs): Promise<number> {
  const candidate = await inspectHarnessUpgradeCandidate({ harnessRoot: absolutePath(args.operands[1]!), cwd: process.cwd() })
  const result = await verifyHarnessUpgrade({
    stackRoot: absolutePath(args.operands[0]!),
    candidateHarnessRoot: candidate.root,
    cwd: process.cwd(),
    dshHome: args.dshHome,
    host: args.host,
    port: args.port,
  })
  if (args.json) console.log(JSON.stringify({ candidate: result.candidate, receipt: result.receipt, candidateStack: result.candidateStack }, null, 2))
  else console.log(`UPGRADE CANDIDATE ${result.receipt.verification.result.toUpperCase()}\nHarness: ${result.candidate.version}${result.candidate.commit === undefined ? '' : ` (${result.candidate.commit})`}\nCandidate receipt: ${result.receiptPath}`)
  return result.receipt.verification.result === 'pass' ? EXIT_CODES.success : result.receipt.verification.result === 'unsupported' ? EXIT_CODES.unsupported : EXIT_CODES.failure
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv)
  if (parsed === 'help') { console.log(HELP); return EXIT_CODES.success }
  if (parsed === 'version') { console.log(VERSION); return EXIT_CODES.success }
  if (parsed.command === 'inspect') return inspectCommand(parsed)
  if (parsed.command === 'drift') return driftCommand(parsed)
  if (parsed.command === 'rebase') return rebaseCommand(parsed)
  if (parsed.command === 'promote') return promoteCommand(parsed)
  if (parsed.command === 'pack') return packCommand(parsed)
  if (parsed.command === 'import') return importCommand(parsed)
  if (parsed.command === 'update') return updateCommand(parsed)
  if (parsed.command === 'upgrade-verify') return upgradeVerifyCommand(parsed)
  if (parsed.live) {
    const d = { code: 'LIVE_VERIFICATION_UNSUPPORTED' as const, stage: 'LIVE_TEST' as const, message: 'Live verification is reserved and unsupported in V0.1; no LLM or external API call was made.', action: 'Use runtime verification for deterministic environment proof.' }
    if (parsed.json) console.log(JSON.stringify({ result: 'unsupported', diagnostics: [d] }, null, 2))
    else console.log(displayDiagnostic(d))
    return EXIT_CODES.unsupported
  }
  if (parsed.command === 'freeze') {
    const output = absolutePath(parsed.output ?? `./artifacts/${parsed.profile}`)
    const base = parsed.baseStack === undefined ? undefined : await baseReference(parsed.baseStack)
    const result = await freezeProfile({ profile: parsed.profile, output, harnessRoot: parsed.harnessRoot, dshHome: parsed.dshHome, cwd: process.cwd(), force: parsed.force, base })
    if (parsed.json) console.log(JSON.stringify(result, null, 2))
    else console.log(`FROZEN\nArtifact: ${result.output}\nStack: ${result.manifest.id} ${result.manifest.version}\nHarness: ${result.installation.version}\nConsistency: ${result.manifest.source.consistency}\nIntegrity: ${result.integrity.artifactHash}`)
    return EXIT_CODES.success
  }
  const stackRoot = resolve(parsed.stackRoot!)
  if (parsed.command === 'package') {
    const architectureSuffix = parsed.arch === undefined ? '' : ` ${parsed.arch}`
    const output = absolutePath(parsed.output ?? `./dist/reference-client/${parsed.profile === 'web' ? `DeepSeek Desktop (Unofficial)${architectureSuffix}.app` : `DeepSeek Desktop ${parsed.profile}${architectureSuffix}.app`}`)
    const result = await packageStack({ stackRoot, output, harnessRoot: parsed.harnessRoot, dshHome: parsed.dshHome, cwd: process.cwd(), arch: parsed.arch, nodeRuntime: parsed.nodeRuntime, signingIdentity: parsed.signingIdentity, hardenedRuntime: parsed.hardenedRuntime || undefined, sizeReport: parsed.sizeReport })
    if (parsed.json) console.log(JSON.stringify(result, null, 2))
    else console.log(`PACKAGED\nClient: ${result.appPath}\nArchitecture: ${result.platform.arch}\nSigning: ${result.signing.mode}${result.signing.hardenedRuntime ? ' + hardened-runtime' : ''}\nHarness: ${result.harnessVersion}\nRuntime: ${result.runtimeRoot}${result.sizeReportPath === undefined ? '' : `\nSize report: ${result.sizeReportPath}`}`)
    return EXIT_CODES.success
  }
  if (parsed.command === 'verify') {
    const result = await verifyStack({ stackRoot, harnessRoot: parsed.harnessRoot, dshHome: parsed.dshHome, cwd: process.cwd(), keepTemp: parsed.keepTemp, host: parsed.host, port: parsed.port })
    if (parsed.json) console.log(JSON.stringify(result.receipt, null, 2))
    else console.log(`RESULT\n${result.receipt.verification.result.toUpperCase()}\nReceipt: ${result.receiptPath}${result.receipt.diagnostics.length === 0 ? '' : `\n${result.receipt.diagnostics.map(displayDiagnostic).join('\n')}`}`)
    return result.exitCode
  }
  await runCleanStack({ stackRoot, harnessRoot: parsed.harnessRoot, dshHome: parsed.dshHome, cwd: process.cwd(), host: parsed.host, port: parsed.port, onReady: processInfo => console.log(`Official Harness Web UI: ${processInfo.url}\nPress Ctrl-C to stop the clean run.`) })
  return EXIT_CODES.success
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await main()
  } catch (error) {
    if (error instanceof DshStackError) {
      console.error(displayDiagnostic(error.diagnostic))
      process.exitCode = error.exitCode
    } else {
      console.error(displayDiagnostic({ code: 'INTERNAL_ERROR', stage: 'INSPECT', message: String(error), action: 'Inspect the command and rerun with diagnostics.' }))
      process.exitCode = EXIT_CODES.internalError
    }
  }
}
