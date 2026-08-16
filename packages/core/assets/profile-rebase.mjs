import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

const MISSING = Symbol('missing')
const excludedSegments = new Set(['.git', '.dsh', 'node_modules', 'cache', 'caches', 'coverage', 'dist', 'build', 'tmp', 'sessions', 'session', 'logs'])
const excludedFiles = new Set(['.DS_Store', '.env', '.env.local', '.env.production', 'credentials.yaml', '.credentials.yaml', 'session.json', 'history.json'])

function excluded(path) {
  const pieces = path.split('/')
  return pieces.some(piece => excludedSegments.has(piece)) || excludedFiles.has(basename(path))
}

async function collect(root, current = root, files = new Map()) {
  let entries
  try { entries = await readdir(current, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') return files
    throw error
  }
  for (const entry of entries) {
    const full = join(current, entry.name)
    const path = relative(root, full).split('\\').join('/')
    if (excluded(path)) continue
    if (entry.isDirectory()) await collect(root, full, files)
    else if (entry.isFile()) files.set(path, await readFile(full))
  }
  return files
}

async function copyIfPresent(source, destination) {
  try {
    await cp(source, destination, { recursive: true, dereference: true, force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/**
 * Merge the already-resolved closures without becoming a dependency resolver:
 * user packages are retained, while the new Base closure wins on overlap.
 */
export async function mergeDependencyClosure({ baseProfile, currentProfile, candidateProfile }) {
  await copyIfPresent(join(currentProfile, 'node_modules'), join(candidateProfile, 'node_modules'))
  await copyIfPresent(join(baseProfile, 'node_modules'), join(candidateProfile, 'node_modules'))
}

function equalBytes(a, b) {
  if (a === MISSING || b === MISSING) return a === b
  return Buffer.compare(a, b) === 0
}

function equalValue(a, b) {
  if (a === MISSING || b === MISSING) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

function objectValue(value) {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function stringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined
}

function keyedArray(value) {
  if (!Array.isArray(value)) return undefined
  const result = []
  for (const item of value) {
    const object = objectValue(item)
    const key = object?.id ?? object?.name
    if (!object || typeof key !== 'string' || key.length === 0) return undefined
    result.push({ key, value: object })
  }
  return result
}

function conflict(path, reason) { return { conflicts: [`${path}: ${reason}`], value: MISSING } }

function mergeStringArray(base, user, next, path) {
  const baseSet = new Set(base)
  const userSet = new Set(user)
  const nextSet = new Set(next)
  const userAdded = user.filter(item => !baseSet.has(item))
  const userRemoved = base.filter(item => !userSet.has(item))
  const nextAdded = next.filter(item => !baseSet.has(item))
  const nextRemoved = base.filter(item => !nextSet.has(item))
  const removalConflict = userRemoved.find(item => nextAdded.includes(item))
  if (removalConflict !== undefined) return conflict(path, `user removed ${JSON.stringify(removalConflict)} while the new Base added it`)
  const additionConflict = userAdded.find(item => nextRemoved.includes(item))
  if (additionConflict !== undefined) return conflict(path, `user added ${JSON.stringify(additionConflict)} while the new Base removed it`)
  const baseOrder = JSON.stringify(base)
  if (JSON.stringify(user) !== baseOrder && JSON.stringify(next) !== baseOrder && JSON.stringify(user) !== JSON.stringify(next)
    && userSet.size === baseSet.size && nextSet.size === baseSet.size) return conflict(path, 'user and new Base both changed the order of the same entries')
  const outputSet = new Set([...next, ...user])
  for (const item of [...userRemoved, ...nextRemoved]) outputSet.delete(item)
  const output = []
  for (const item of [...next, ...user, ...base]) if (outputSet.has(item) && !output.includes(item)) output.push(item)
  return { conflicts: [], value: output }
}

function mergeValue(base, user, next, path) {
  if (equalValue(user, base)) return { conflicts: [], value: next }
  if (equalValue(next, base)) return { conflicts: [], value: user }
  if (equalValue(user, next)) return { conflicts: [], value: user }
  const userObject = objectValue(user)
  const nextObject = objectValue(next)
  if (userObject && nextObject) return mergeObject(objectValue(base), userObject, nextObject, path)
  const baseStrings = stringArray(base)
  const userStrings = stringArray(user)
  const nextStrings = stringArray(next)
  if (baseStrings && userStrings && nextStrings) return mergeStringArray(baseStrings, userStrings, nextStrings, path)
  const baseRows = keyedArray(base)
  const userRows = keyedArray(user)
  const nextRows = keyedArray(next)
  if (baseRows && userRows && nextRows) {
    const baseMap = new Map(baseRows.map(row => [row.key, row.value]))
    const userMap = new Map(userRows.map(row => [row.key, row.value]))
    const nextMap = new Map(nextRows.map(row => [row.key, row.value]))
    const keys = [...new Set([...baseRows, ...userRows, ...nextRows].map(row => row.key))]
    const values = new Map()
    for (const key of keys) {
      const result = mergeValue(baseMap.get(key) ?? MISSING, userMap.get(key) ?? MISSING, nextMap.get(key) ?? MISSING, `${path}[${key}]`)
      if (result.conflicts.length > 0) return result
      if (result.value !== MISSING) values.set(key, result.value)
    }
    const output = []
    for (const key of [...nextRows, ...userRows, ...baseRows].map(row => row.key)) {
      if (values.has(key) && !output.includes(values.get(key))) output.push(values.get(key))
    }
    return { conflicts: [], value: output }
  }
  return conflict(path, 'both user and new Base changed the same value')
}

function mergeObject(base, user, next, path) {
  const output = {}
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(user), ...Object.keys(next)])
  for (const key of keys) {
    const baseHas = base && Object.prototype.hasOwnProperty.call(base, key)
    const userHas = Object.prototype.hasOwnProperty.call(user, key)
    const nextHas = Object.prototype.hasOwnProperty.call(next, key)
    const baseValue = baseHas ? base[key] : MISSING
    const userValue = userHas ? user[key] : MISSING
    const nextValue = nextHas ? next[key] : MISSING
    if (!userHas && !nextHas) continue
    if (!userHas && baseHas && !equalValue(nextValue, baseValue)) return conflict(`${path}.${key}`, 'user deleted a value changed by the new Base')
    if (!nextHas && baseHas && !equalValue(userValue, baseValue)) return conflict(`${path}.${key}`, 'new Base deleted a value changed by the user')
    const result = mergeValue(baseValue, userValue, nextValue, `${path}.${key}`)
    if (result.conflicts.length > 0) return result
    if (result.value !== MISSING) output[key] = result.value
  }
  return { conflicts: [], value: output }
}

async function parse(path, bytes, yaml) {
  try {
    const text = bytes.toString('utf8')
    if (path.endsWith('.json')) return JSON.parse(text)
    if (path.endsWith('.yaml') || path.endsWith('.yml')) return yaml.load(text, { schema: yaml.JSON_SCHEMA })
  } catch { return undefined }
  return undefined
}

function serialize(path, value, yaml) {
  return Buffer.from(path.endsWith('.json') ? JSON.stringify(value, null, 2) + '\n' : yaml.dump(value, { noRefs: true, lineWidth: 120, sortKeys: false }), 'utf8')
}

/** The same conservative three-way rule used by the Stack lifecycle core. */
export async function rebaseProfiles({ oldBase, current, newBase, output, yaml }) {
  const [baseFiles, userFiles, nextFiles] = await Promise.all([collect(oldBase), collect(current), collect(newBase)])
  const paths = [...new Set([...baseFiles.keys(), ...userFiles.keys(), ...nextFiles.keys()])].sort()
  const merged = new Map()
  const conflicts = []
  for (const path of paths) {
    const base = baseFiles.get(path) ?? MISSING
    const user = userFiles.get(path) ?? MISSING
    const next = nextFiles.get(path) ?? MISSING
    let result
    if (equalBytes(user, base)) result = { conflicts: [], value: next }
    else if (equalBytes(next, base)) result = { conflicts: [], value: user }
    else if (equalBytes(user, next)) result = { conflicts: [], value: user }
    else {
      const [parsedBase, parsedUser, parsedNext] = await Promise.all([
        base === MISSING ? undefined : parse(path, base, yaml),
        user === MISSING ? undefined : parse(path, user, yaml),
        next === MISSING ? undefined : parse(path, next, yaml),
      ])
      result = parsedBase !== undefined && parsedUser !== undefined && parsedNext !== undefined
        ? mergeValue(parsedBase, parsedUser, parsedNext, path)
        : conflict(path, 'both user and new Base changed a non-mergeable file')
      if (result.conflicts.length === 0 && result.value !== MISSING) merged.set(path, serialize(path, result.value, yaml))
    }
    if (result.conflicts.length > 0) conflicts.push(...result.conflicts)
    else if (result.value !== MISSING && !merged.has(path)) merged.set(path, result.value)
  }
  if (conflicts.length > 0) return { status: 'UPDATE_REBASE_CONFLICT', conflicts }
  await mkdir(output, { recursive: true })
  for (const [path, bytes] of merged) {
    const target = join(output, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  return { status: 'PASS', conflicts: [], files: [...merged.keys()].sort() }
}
