import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

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
  writeFileSync(`${packageRoot}/package.json`, JSON.stringify({ type: 'module', exports: './index.js' }))
  writeFileSync(
    `${packageRoot}/index.js`,
    [
      `export * from ${JSON.stringify(importSpecifier)};`,
      options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
      '',
    ].join('\n'),
  )
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
  const packageConfig = existsSync(packagePath)
    ? JSON.parse(readFileSync(packagePath, 'utf8'))
    : { type: 'module', exports: {} }
  const exports =
    typeof packageConfig.exports === 'object' && packageConfig.exports != null ? packageConfig.exports : {}

  mkdirSync(dirname(entryPath), { recursive: true })
  exports[`./${subpath}`] = `./${subpath}.js`
  writeFileSync(
    packagePath,
    JSON.stringify({
      ...packageConfig,
      type: 'module',
      exports,
    }),
  )
  writeFileSync(
    entryPath,
    [
      `export * from ${JSON.stringify(importSpecifier)};`,
      options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
      '',
    ].join('\n'),
  )
}
