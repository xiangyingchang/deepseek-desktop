import { readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

export interface PackageSizeBucket {
  bytes: number
  mebibytes: number
}

export interface PackageSizeReport {
  schemaVersion: 1
  scope: 'macos-app-contents-excluding-report'
  generatedAt: string
  appName: string
  profile: string
  architecture: string
  categories: {
    nativeShell: PackageSizeBucket
    nodeRuntime: PackageSizeBucket
    harnessRuntime: PackageSizeBucket
    profile: PackageSizeBucket
    profileDependencies: PackageSizeBucket
    other: PackageSizeBucket
  }
  total: PackageSizeBucket
  baseline?: {
    bytes: number
    warning: boolean
    message: string
  }
}

function bucket(bytes: number): PackageSizeBucket {
  return { bytes, mebibytes: Number((bytes / 1024 / 1024).toFixed(2)) }
}

async function treeSize(root: string, skip?: (path: string) => boolean): Promise<number> {
  if (skip?.(root) === true) return 0
  try {
    const info = await stat(root)
    if (info.isFile()) return info.size
    if (!info.isDirectory()) return 0
  } catch {
    return 0
  }
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (skip?.(path) === true) continue
    total += await treeSize(path, skip)
  }
  return total
}

/** Build an auditable closure breakdown without adding the report to the App itself. */
export async function createPackageSizeReport(options: {
  appPath: string
  profile: string
  architecture: string
  baselineBytes?: number
}): Promise<PackageSizeReport> {
  const contents = join(options.appPath, 'Contents')
  const resources = join(contents, 'Resources')
  const reportPath = join(options.appPath, 'package-size-report.json')
  const skipReport = (path: string): boolean => path === reportPath
  const nativeShellBytes = await treeSize(join(contents, 'MacOS'))
  const nodeRuntimeBytes = await treeSize(join(resources, 'node')) + await treeSize(join(resources, 'lib'))
  const harnessRuntimeBytes = await treeSize(join(resources, 'harness'))
  const profileDependenciesBytes = await treeSize(join(resources, 'profile', 'node_modules'))
  const profileBytes = await treeSize(join(resources, 'profile'), path => path === join(resources, 'profile', 'node_modules') || skipReport(path))
  const contentsBytes = await treeSize(contents, skipReport)
  const accounted = nativeShellBytes + nodeRuntimeBytes + harnessRuntimeBytes + profileBytes + profileDependenciesBytes
  const otherBytes = Math.max(0, contentsBytes - accounted)
  const totalBytes = nativeShellBytes + nodeRuntimeBytes + harnessRuntimeBytes + profileBytes + profileDependenciesBytes + otherBytes
  const report: PackageSizeReport = {
    schemaVersion: 1,
    scope: 'macos-app-contents-excluding-report',
    generatedAt: new Date().toISOString(),
    appName: relative(dirname(options.appPath), options.appPath),
    profile: options.profile,
    architecture: options.architecture,
    categories: {
      nativeShell: bucket(nativeShellBytes),
      nodeRuntime: bucket(nodeRuntimeBytes),
      harnessRuntime: bucket(harnessRuntimeBytes),
      profile: bucket(profileBytes),
      profileDependencies: bucket(profileDependenciesBytes),
      other: bucket(otherBytes),
    },
    total: bucket(totalBytes),
  }
  if (options.baselineBytes !== undefined && Number.isFinite(options.baselineBytes) && options.baselineBytes > 0) {
    const warning = totalBytes > options.baselineBytes * 1.1
    report.baseline = {
      bytes: options.baselineBytes,
      warning,
      message: warning
        ? `Package size is ${(totalBytes / options.baselineBytes * 100 - 100).toFixed(1)}% above the baseline.`
        : 'Package size is within the 10% baseline warning threshold.',
    }
  }
  return report
}

export async function writePackageSizeReport(path: string, report: PackageSizeReport): Promise<void> {
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8')
}
