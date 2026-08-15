import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'

/** Expand a leading `~` and return an absolute normalized path. */
export function absolutePath(value: string, cwd = process.cwd()): string {
  const expanded = value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  return normalize(isAbsolute(expanded) ? expanded : join(cwd, expanded))
}

/** Resolve a profile directory without allowing traversal or nested profile names. */
export function profileDirectory(dshHome: string, name: string): string {
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`invalid profile name ${JSON.stringify(name)}`)
  }
  return join(dshHome, 'profiles', name)
}

/** Return a portable slash-separated relative path for artifact metadata. */
export function portableRelativePath(value: string): string {
  return value.split('\\').join('/')
}
