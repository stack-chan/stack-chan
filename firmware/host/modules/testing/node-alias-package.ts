import { mkdirSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

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
