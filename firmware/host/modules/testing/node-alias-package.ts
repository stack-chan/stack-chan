import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

let atomicWriteCounter = 0
// Every process publishes the same map. Merging per-subpath maps loses updates
// between workers and Node can cache that incomplete map before later aliases exist.
const packageConfig = JSON.stringify({ type: 'module', exports: { '.': './index.js', './*': './*.js' } })

// node --test runs each test file in its own process, and several files write the
// same shared node_modules/<alias> packages concurrently. A plain writeFileSync lets
// one process read a half-written package.json ("Invalid package config"), so publish
// each file atomically via a per-process temp file + rename.
function atomicWriteFileSync(path: string, content: string): void {
  const tempPath = `${path}.${process.pid}.${atomicWriteCounter++}.tmp`
  writeFileSync(tempPath, content)
  renameSync(tempPath, path)
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
  mkdirSync(packageRoot, { recursive: true })
  atomicWriteFileSync(
    `${packageRoot}/index.js`,
    [
      `export * from ${JSON.stringify(importSpecifier)};`,
      options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
      '',
    ].join('\n'),
  )
  atomicWriteFileSync(`${packageRoot}/package.json`, packageConfig)
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
  const packagePath = `${packageRoot}/package.json`
  mkdirSync(dirname(entryPath), { recursive: true })
  atomicWriteFileSync(
    entryPath,
    [
      `export * from ${JSON.stringify(importSpecifier)};`,
      options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
      '',
    ].join('\n'),
  )
  atomicWriteFileSync(packagePath, packageConfig)
}
