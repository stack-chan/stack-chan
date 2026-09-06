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

test('public SDK resolves only its own modules and never imports a host implementation', (t) => {
  const api = new API({ cwd: process.cwd() })
  t.after(() => api.close())
  const snapshot = api.updateSnapshot({ openProjects: [resolve('tsconfig.sdk.json')] })
  const project = snapshot.getProject(resolve('tsconfig.sdk.json'))
  assert.ok(project)
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
  for (const file of files) {
    const source = project.program.getSourceFile(file)
    assert.ok(source)
    const inspect = (node: ts.Node) => {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : undefined
      if (specifier && ts.isStringLiteral(specifier)) {
        const target = targets.get(specifier.text) ?? resolve(dirname(file), `${specifier.text}.ts`)
        assert.ok(files.has(target), `${file} imports non-SDK module ${specifier.text}`)
        const resolved = project.checker.getSymbolAtLocation(specifier)?.declarations
        assert.ok(resolved?.length, `${file}: unresolved module ${specifier.text}`)
        for (const declaration of resolved) assert.equal(resolve(declaration.path), target)
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
  const config = api.parseConfigFile(resolve('tsconfig.sdk.json'))
  assert.equal(config.options.checkJs, true, 'included JavaScript must actually be checked')
  assert.equal(config.options.strict, true)
  const included = new Set(config.fileNames.map((path) => resolve(path)))
  const project = api
    .updateSnapshot({ openProjects: [resolve('tsconfig.sdk.json')] })
    .getProject(resolve('tsconfig.sdk.json'))
  assert.ok(project)
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
  assert.ok(apps.length > 0)
  for (const directory of apps) {
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
