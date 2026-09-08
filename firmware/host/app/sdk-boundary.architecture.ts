import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import * as ts from 'typescript/unstable/ast'
import { API } from 'typescript/unstable/sync'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || /\.(test|architecture)\./.test(entry.name)) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.[jt]s$/.test(entry.name) ? [resolve(path)] : []
  })
}

test('public SDK and its shared portable contracts never import a host implementation', (t) => {
  const api = new API({ cwd: process.cwd() })
  t.after(() => api.close())
  const snapshot = api.updateSnapshot({
    openProjects: [resolve('tsconfig.sdk.json'), resolve('tsconfig.extensions.json')],
  })
  const core = snapshot.getProject(resolve('tsconfig.sdk.json'))
  const extension = snapshot.getProject(resolve('tsconfig.extensions.json'))
  assert.ok(core && extension)
  const piu = resolve('sdk/extensions/piu.ts')
  assert.equal(core.program.getSourceFile(piu), undefined, 'basic apps must not inherit Piu globals or types')
  const sdkRoot = resolve('sdk')
  const manifest = JSON.parse(readFileSync(join(sdkRoot, 'manifest.json'), 'utf8')) as {
    modules: Record<string, string>
  }
  const files = new Set(sourceFiles(sdkRoot))
  const targets = new Map(
    Object.entries(manifest.modules).map(([name, path]) => [name, resolve(sdkRoot, `${path}.ts`)]),
  )
  assert.equal(
    new Set(targets.values()).size,
    targets.size,
    'each SDK specifier needs a distinct source for Moddable type resolution',
  )
  for (const [name, path] of targets) assert.ok(files.has(path), `${name} must resolve to an SDK source`)
  const contractManifest = JSON.parse(readFileSync('contracts/manifest.json', 'utf8')) as {
    modules: Record<string, string>
  }
  const contracts = new Map(
    Object.entries(contractManifest.modules).map(([name, path]) => [name, resolve('contracts', `${path}.js`)]),
  )
  for (const file of files) {
    const project = file.startsWith(`${resolve('sdk/extensions')}/`) ? extension : core
    const source = project.program.getSourceFile(file)
    assert.ok(source)
    const inspect = (node: ts.Node) => {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : undefined
      if (specifier && ts.isStringLiteral(specifier)) {
        const resolved = project.checker.getSymbolAtLocation(specifier)?.declarations
        assert.ok(resolved?.length, `${file}: unresolved module ${specifier.text}`)
        if (file === piu && specifier.text === 'piu/MC') {
          for (const declaration of resolved)
            assert.ok(resolve(declaration.path).startsWith(`${resolve('node_modules/@moddable/typings/piu')}/`))
        } else {
          const target =
            targets.get(specifier.text) ??
            contracts.get(specifier.text) ??
            resolve(dirname(file), /\.[jt]s$/.test(specifier.text) ? specifier.text : `${specifier.text}.ts`)
          // Portable data contracts can be shared with installers. Traverse their imports too;
          // placing an implementation behind a contract must not bypass the SDK boundary.
          if (target.startsWith(`${resolve('contracts')}/`)) {
            assert.ok(existsSync(target), `${file}: missing contract ${target}`)
            files.add(target)
          }
          assert.ok(files.has(target), `${file} imports non-portable module ${specifier.text}`)
          if (file !== piu) assert.notEqual(target, piu, 'basic SDK must not depend on the Piu extension')
          for (const declaration of resolved) assert.equal(resolve(declaration.path), target)
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.fail(`${file} must keep dependencies statically inspectable`)
      }
      node.forEachChild(inspect)
    }
    inspect(source)
  }
})

test('every SDK app and its local helpers resolve only public SDK or app-local dependencies under strict checks', (t) => {
  const api = new API({ cwd: process.cwd() })
  t.after(() => api.close())
  const snapshot = api.updateSnapshot({
    openProjects: [resolve('tsconfig.sdk.json'), resolve('tsconfig.extensions.json')],
  })
  const sdk = new Set(sourceFiles('sdk'))
  const apps = ['lessons', 'mods/examples']
    .flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name)),
    )
    .filter((directory) => {
      const metadata = join(directory, 'stackchan-mod.json')
      return existsSync(metadata) && JSON.parse(readFileSync(metadata, 'utf8')).appApiVersion === 2
    })
  apps.push('host/app/default-app')
  assert.ok(apps.length > 1)
  for (const directory of apps) {
    const builtin = directory === 'host/app/default-app'
    const metadata = builtin
      ? { capabilities: ['ui.controls'] }
      : JSON.parse(readFileSync(join(directory, 'stackchan-mod.json'), 'utf8'))
    const usesPiu = metadata.capabilities.includes('ui.piu')
    const usesExtensions = usesPiu || metadata.capabilities.includes('ui.controls')
    const configPath = resolve(usesExtensions ? 'tsconfig.extensions.json' : 'tsconfig.sdk.json')
    const config = api.parseConfigFile(configPath)
    assert.equal(config.options.checkJs, true)
    assert.equal(config.options.strict, true)
    const included = new Set(config.fileNames.map((path) => resolve(path)))
    const project = snapshot.getProject(configPath)
    assert.ok(project)
    const local = new Set(sourceFiles(directory))
    for (const file of local) {
      assert.ok(included.has(file), `SDK app source is missing from public type checks: ${file}`)
      const source = project.program.getSourceFile(file)
      assert.ok(source)
      const inspect = (node: ts.Node) => {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : undefined
        if (specifier && ts.isStringLiteral(specifier)) {
          const resolved = project.checker.getSymbolAtLocation(specifier)?.declarations
          assert.ok(resolved?.length, `${file}: unresolved module ${specifier.text}`)
          for (const declaration of resolved) {
            const path = resolve(declaration.path)
            assert.ok(sdk.has(path) || local.has(path), `${file} imports non-public module ${specifier.text}: ${path}`)
            if (!usesPiu) assert.notEqual(path, resolve('sdk/extensions/piu.ts'), `${file} must declare ui.piu`)
          }
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          assert.fail(`${file} must keep dependencies statically inspectable`)
        node.forEachChild(inspect)
      }
      inspect(source)
    }
  }
})
