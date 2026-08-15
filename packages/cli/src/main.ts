#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  EXIT_CODES,
  DshStackError,
  SourceHarnessAdapter,
  absolutePath,
  freezeProfile,
  packageStack,
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

Common options:
  --profile <name>        Profile name under DSH_HOME (default: web)
  --harness <path>        DeepSeek Harness source checkout
  --dsh-home <path>      Harness home (default: $DSH_HOME or ~/.dsh)
  --json                  emit machine-readable output
  --help                  show this help
  --version               show the DSH Stack version

Freeze options:
  --output <path>         artifact directory (default: ./artifacts/<profile>)
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
  command: 'inspect' | 'freeze' | 'verify' | 'run' | 'package'
  profile: string
  harnessRoot?: string
  dshHome?: string
  output?: string
  stackRoot?: string
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
  if (command !== 'inspect' && command !== 'freeze' && command !== 'verify' && command !== 'run' && command !== 'package') throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `Unknown command ${JSON.stringify(command)}`, action: 'Run dsh-stack --help to see the supported commands.' }, EXIT_CODES.invalidInput)
  const parsed: ParsedArgs = { command, profile: 'web', json: false, force: false, clean: false, live: false, keepTemp: false, hardenedRuntime: false, sizeReport: false }
  let positional: string | undefined
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
    else if (positional === undefined) positional = token
    else throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `Unexpected argument ${token}`, action: 'Pass only one Stack path for verify/run.' }, EXIT_CODES.invalidInput)
  }
  parsed.stackRoot = positional
  if ((command === 'verify' || command === 'run' || command === 'package') && positional === undefined) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: `${command} requires a Stack path`, action: `Run dsh-stack ${command} <stack-path>.` }, EXIT_CODES.invalidInput)
  if (command === 'run' && !parsed.clean) throw new DshStackError({ code: 'INVALID_ARGUMENT', stage: 'INSPECT', message: 'run requires --clean', action: 'Use run <stack> --clean so the disposable materialization is explicit.' }, EXIT_CODES.invalidInput)
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

async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv)
  if (parsed === 'help') { console.log(HELP); return EXIT_CODES.success }
  if (parsed === 'version') { console.log(VERSION); return EXIT_CODES.success }
  if (parsed.command === 'inspect') return inspectCommand(parsed)
  if (parsed.live) {
    const d = { code: 'LIVE_VERIFICATION_UNSUPPORTED' as const, stage: 'LIVE_TEST' as const, message: 'Live verification is reserved and unsupported in V0.1; no LLM or external API call was made.', action: 'Use runtime verification for deterministic environment proof.' }
    if (parsed.json) console.log(JSON.stringify({ result: 'unsupported', diagnostics: [d] }, null, 2))
    else console.log(displayDiagnostic(d))
    return EXIT_CODES.unsupported
  }
  if (parsed.command === 'freeze') {
    const output = absolutePath(parsed.output ?? `./artifacts/${parsed.profile}`)
    const result = await freezeProfile({ profile: parsed.profile, output, harnessRoot: parsed.harnessRoot, dshHome: parsed.dshHome, cwd: process.cwd(), force: parsed.force })
    if (parsed.json) console.log(JSON.stringify(result, null, 2))
    else console.log(`FROZEN\nArtifact: ${result.output}\nStack: ${result.manifest.id} ${result.manifest.version}\nHarness: ${result.installation.version}\nConsistency: ${result.manifest.source.consistency}\nIntegrity: ${result.integrity.artifactHash}`)
    return EXIT_CODES.success
  }
  const stackRoot = resolve(parsed.stackRoot!)
  if (parsed.command === 'package') {
    const architectureSuffix = parsed.arch === undefined ? '' : ` ${parsed.arch}`
    const output = absolutePath(parsed.output ?? `./dist/reference-client/${parsed.profile === 'web' ? `DSH Stack Reference${architectureSuffix}.app` : `DSH Stack ${parsed.profile}${architectureSuffix}.app`}`)
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
