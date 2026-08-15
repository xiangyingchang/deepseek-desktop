import type { Diagnostic, ErrorCode, Stage } from './types.ts'

/** A typed failure that preserves the pipeline stage and public error code. */
export class DshStackError extends Error {
  readonly diagnostic: Diagnostic
  readonly exitCode: 1 | 2 | 3 | 4

  constructor(diagnostic: Diagnostic, exitCode: 1 | 2 | 3 | 4 = 1) {
    super(diagnostic.message)
    this.name = 'DshStackError'
    this.diagnostic = diagnostic
    this.exitCode = exitCode
  }
}

/** Build a diagnostic without leaking command output or secret values. */
export function diagnostic(
  code: ErrorCode,
  stage: Stage,
  message: string,
  options: Pick<Diagnostic, 'component' | 'action' | 'details'> = {},
): Diagnostic {
  return { code, stage, message, ...options }
}

/** Convert an unknown thrown value into an actionable internal diagnostic. */
export function asDiagnostic(error: unknown, stage: Stage): Diagnostic {
  if (error instanceof DshStackError) return error.diagnostic
  const message = error instanceof Error ? error.message : String(error)
  return diagnostic('INTERNAL_ERROR', stage, message, {
    action: 'Inspect the stage diagnostics and rerun with the same artifact.',
  })
}
