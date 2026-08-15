import { readStackManifest, verifyIntegrity, diagnostic, DshStackError, type HarnessInstallation } from './index.ts'
import { currentPlatform, SourceHarnessAdapter } from './source-adapter.ts'
import { StackMaterializer, startOfficialWeb, type HarnessProcess, type MaterializedEnvironment } from './materializer.ts'

/** Keep the exact materialized official Harness Web UI alive for a user. */
export async function runCleanStack(options: {
  stackRoot: string
  harnessRoot?: string
  dshHome?: string
  cwd?: string
  host?: string
  port?: number
  onReady?: (process: HarnessProcess, environment: MaterializedEnvironment) => void
}): Promise<void> {
  const stack = await readStackManifest(options.stackRoot)
  const integrity = await verifyIntegrity(options.stackRoot)
  if (integrity.diagnostics.length > 0 || integrity.manifest === undefined) throw new DshStackError(integrity.diagnostics[0] ?? diagnostic('STACK_INTEGRITY_ERROR', 'STATIC_VERIFY', 'Stack integrity is invalid'))
  const adapter = new SourceHarnessAdapter()
  let installation: HarnessInstallation
  try {
    installation = await adapter.detectInstallation({ cwd: options.cwd, harnessRoot: options.harnessRoot, dshHome: options.dshHome })
  } catch (error) {
    throw new DshStackError(diagnostic('HARNESS_NOT_FOUND', 'STATIC_VERIFY', String(error), {
      action: 'Pass --harness <DeepSeek Harness checkout> or set DSH_HARNESS_ROOT.',
    }), 2)
  }
  if (installation.version !== stack.harness.version) throw new DshStackError(diagnostic('HARNESS_VERSION_MISMATCH', 'STATIC_VERIFY', `Stack requires Harness ${stack.harness.version}, found ${installation.version}`, {
    action: 'Use the exact Harness version named by the Stack.',
  }))
  const current = currentPlatform()
  if (!stack.environment.platform.os.includes(current.os) || !stack.environment.platform.arch.includes(current.arch)) throw new DshStackError(diagnostic('UNSUPPORTED_PLATFORM', 'STATIC_VERIFY', `Stack does not declare ${current.os} ${current.arch}`, {
    action: 'Run on a declared platform or freeze a compatible Stack.',
  }), 2)
  const environment = await new StackMaterializer().materialize({ stackRoot: options.stackRoot, stack, installation })
  let harnessProcess: HarnessProcess | undefined
  try {
    harnessProcess = await startOfficialWeb(environment, { host: options.host, port: options.port })
    options.onReady?.(harnessProcess, environment)
    await new Promise<void>(resolve => {
      const stop = async (): Promise<void> => {
        if (harnessProcess !== undefined) await harnessProcess.stop()
        resolve()
      }
      process.once('SIGINT', () => { void stop() })
      process.once('SIGTERM', () => { void stop() })
    })
  } finally {
    if (harnessProcess !== undefined) await harnessProcess.stop().catch(() => {})
    await environment.cleanup()
  }
}
