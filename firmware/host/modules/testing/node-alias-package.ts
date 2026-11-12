import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

let atomicWriteCounter = 0

// node --test runs each test file in its own process, and several files write the
// same shared node_modules/<alias> packages concurrently. A plain writeFileSync lets
// one process read a half-written package.json ("Invalid package config"), so publish
// each file atomically via a per-process temp file + rename.
function atomicWriteFileSync(path: string, content: string): void {
  try {
    // Windowsの共有filesystemではrenameによる置換中に既存fileが一時的に見えなくなる
    if (readFileSync(path, 'utf8') === content) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const tempPath = `${path}.${process.pid}.${atomicWriteCounter++}.tmp`
  writeFileSync(tempPath, content)
  renameSync(tempPath, path)
}

function publishPackage(packageRoot: string, write: (root: string) => void): void {
  if (existsSync(packageRoot)) {
    write(packageRoot)
    return
  }
  mkdirSync(dirname(packageRoot), { recursive: true })
  const stagingRoot = mkdtempSync(`${packageRoot}.`)
  try {
    write(stagingRoot)
    try {
      // 空のpackage directoryも親directoryのaliasを隠すため、初回は全fileをまとめて公開する
      renameSync(stagingRoot, packageRoot)
    } catch (error) {
      if (!existsSync(packageRoot)) throw error
      write(packageRoot)
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

export function writeAliasPackage(
  modulesRoot: string,
  name: string,
  target: string,
  options: {
    hasDefaultExport?: boolean
  } = {},
): void {
  const packageRoot = resolve(modulesRoot, 'node_modules', name)
  const targetSpecifier = relative(packageRoot, target).replaceAll('\\', '/')
  const importSpecifier = targetSpecifier.startsWith('.') ? targetSpecifier : `./${targetSpecifier}`
  publishPackage(packageRoot, (root) => {
    atomicWriteFileSync(
      `${root}/index.js`,
      [
        `export * from ${JSON.stringify(importSpecifier)};`,
        options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
        '',
      ].join('\n'),
    )
    atomicWriteFileSync(`${root}/package.json`, JSON.stringify({ type: 'module', exports: './index.js' }))
  })
}

export function writeAliasPackageSubpath(
  modulesRoot: string,
  packageName: string,
  subpath: string,
  target: string,
  options: {
    hasDefaultExport?: boolean
  } = {},
): void {
  const packageRoot = resolve(modulesRoot, 'node_modules', packageName)
  const entryPath = resolve(packageRoot, `${subpath}.js`)
  const targetSpecifier = relative(dirname(entryPath), target).replaceAll('\\', '/')
  const importSpecifier = targetSpecifier.startsWith('.') ? targetSpecifier : `./${targetSpecifier}`
  publishPackage(packageRoot, (root) => {
    const packagePath = `${root}/package.json`
    const packageConfig = existsSync(packagePath)
      ? JSON.parse(readFileSync(packagePath, 'utf8'))
      : { type: 'module', exports: {} }
    const exports =
      typeof packageConfig.exports === 'object' && packageConfig.exports != null ? packageConfig.exports : {}
    const entry = resolve(root, `${subpath}.js`)
    mkdirSync(dirname(entry), { recursive: true })
    atomicWriteFileSync(
      entry,
      [
        `export * from ${JSON.stringify(importSpecifier)};`,
        options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
        '',
      ].join('\n'),
    )
    exports[`./${subpath}`] = `./${subpath}.js`
    atomicWriteFileSync(
      packagePath,
      JSON.stringify({
        ...packageConfig,
        type: 'module',
        exports,
      }),
    )
  })
}
