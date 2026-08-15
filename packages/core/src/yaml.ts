import { readFile } from 'node:fs/promises'
import * as yaml from 'js-yaml'

/** Parse YAML with a schema that never evaluates JavaScript tags. */
export async function readSafeYaml(path: string): Promise<unknown> {
  const source = await readFile(path, 'utf8')
  return yaml.load(source, { schema: yaml.JSON_SCHEMA })
}

/** Serialize project-owned YAML with stable key insertion order. */
export function writeYaml(value: unknown): string {
  return yaml.dump(value, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  })
}

/** Return an object when the YAML root is an object, otherwise throw. */
export function asYamlObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML object`)
  }
  return value as Record<string, unknown>
}
