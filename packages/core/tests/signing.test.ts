import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile, chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { listBundleMachOFiles, signApp } from '../src/package-client.ts'

const darwin = process.platform === 'darwin'

const MINIMAL_INFO_PLIST = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
  + '<plist version="1.0"><dict>'
  + '<key>CFBundleExecutable</key><string>deepseek-desktop</string>'
  + '<key>CFBundleIdentifier</key><string>test.mini</string>'
  + '<key>CFBundlePackageType</key><string>APPL</string>'
  + '<key>CFBundleShortVersionString</key><string>0.0.1</string>'
  + '</dict></plist>\n'

test('signApp re-signs every embedded Mach-O, including binaries whose stale signature was invalidated', { skip: !darwin && 'requires macOS codesign' }, async () => {
  const root = await mkdtemp('/tmp/dsh-stack-signing-')
  try {
    const appPath = join(root, 'Mini.app')
    const macos = join(appPath, 'Contents', 'MacOS')
    const resources = join(appPath, 'Contents', 'Resources')
    const prebuild = join(resources, 'harness', 'node_modules', 'pty', 'prebuilds', 'darwin-x64')
    await mkdir(macos, { recursive: true })
    await mkdir(join(resources, 'lib'), { recursive: true })
    await mkdir(prebuild, { recursive: true })
    await writeFile(join(appPath, 'Contents', 'Info.plist'), MINIMAL_INFO_PLIST, 'utf8')
    // Reproduce the rc.8 failure mode exactly as the pipeline creates it:
    // binaries copied from the build host keep their original signature,
    // and an install_name_tool rewrite invalidates it while the Mach-O
    // structure stays valid.
    await copyFile('/bin/ls', join(macos, 'deepseek-desktop'))
    await copyFile(process.execPath, join(resources, 'node'))
    await copyFile(process.execPath, join(resources, 'lib', 'helper.dylib'))
    await copyFile(process.execPath, join(prebuild, 'pty.node'))
    execFileSync('install_name_tool', ['-add_rpath', '@loader_path/lib', join(resources, 'node')])
    execFileSync('install_name_tool', ['-add_rpath', '@loader_path/lib', join(prebuild, 'pty.node')])
    await chmod(join(resources, 'node'), 0o755)

    const machoFiles = await listBundleMachOFiles(appPath)
    assert.deepEqual(machoFiles, [
      join(macos, 'deepseek-desktop'),
      join(resources, 'harness', 'node_modules', 'pty', 'prebuilds', 'darwin-x64', 'pty.node'),
      join(resources, 'lib', 'helper.dylib'),
      join(resources, 'node'),
    ].sort())

    const signing = await signApp(appPath)
    assert.equal(signing.mode, 'adhoc')

    for (const target of machoFiles) {
      execFileSync('codesign', ['--verify', '--strict', target])
    }
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('signApp fails the build instead of shipping a binary it cannot sign', { skip: !darwin && 'requires macOS codesign' }, async () => {
  const root = await mkdtemp('/tmp/dsh-stack-signing-fail-')
  try {
    const appPath = join(root, 'Mini.app')
    const macos = join(appPath, 'Contents', 'MacOS')
    const resources = join(appPath, 'Contents', 'Resources')
    await mkdir(macos, { recursive: true })
    await mkdir(join(resources, 'lib'), { recursive: true })
    await writeFile(join(appPath, 'Contents', 'Info.plist'), MINIMAL_INFO_PLIST, 'utf8')
    await copyFile('/bin/ls', join(macos, 'deepseek-desktop'))
    await copyFile(process.execPath, join(resources, 'node'))
    // Appending bytes breaks the __LINKEDIT structure: codesign refuses to
    // sign it, and Package must surface which binary is broken instead of
    // shipping a bundle AMFI would kill at first load.
    await chmod(join(resources, 'node'), 0o755)
    await appendFile(join(resources, 'node'), 'breaks-the-macho-structure')
    await assert.rejects(() => signApp(appPath), /Unable to sign embedded binary/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
