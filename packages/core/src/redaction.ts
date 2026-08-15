const SECRET_KEY = /(api[_-]?key|token|secret|password|credential|private[_-]?key)/iu
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/gu

/** Replace common credential values before logs or diagnostics are persisted. */
export function redactSecrets(value: string): string {
  const byValue = value.replace(SECRET_VALUE, match => {
    if (match.startsWith('Bearer')) return 'Bearer [REDACTED]'
    if (match.startsWith('-----BEGIN')) return '[REDACTED PRIVATE KEY]'
    return '[REDACTED SECRET]'
  })
  return byValue.replace(
    /((?:api[_-]?key|token|secret|password|credential|private[_-]?key)\s*[=:]\s*)([^\s,;"']+)/giu,
    '$1[REDACTED]',
  )
}

/** Return whether a filename is credential-shaped rather than merely containing a secret name. */
export function isSensitiveFilename(relativePath: string): boolean {
  const lower = relativePath.toLowerCase()
  return lower === '.env'
    || lower.endsWith('.env')
    || lower.includes('credential')
    || lower.includes('secret')
    || lower.endsWith('.pem')
    || lower.endsWith('.key')
}

/** Find high-confidence secret indicators without treating a bare environment name as a value. */
export function detectSecretIndicators(relativePath: string, contents: string): string[] {
  const indicators: string[] = []
  if (isSensitiveFilename(relativePath)) indicators.push(`sensitive filename: ${relativePath}`)
  if (SECRET_VALUE.test(contents)) indicators.push('credential-like value')
  SECRET_VALUE.lastIndex = 0
  for (const match of contents.matchAll(/\b([A-Z][A-Z0-9_]{2,})\s*=\s*([^\s#]+)\b/gu)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined && SECRET_KEY.test(key) && value.length >= 8) {
      indicators.push(`secret assignment: ${key}`)
    }
  }
  return [...new Set(indicators)]
}
