import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import * as ts from 'typescript/unstable/ast'
import { API } from 'typescript/unstable/sync'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
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
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.fail(`${file} must keep dependencies statically inspectable`)
      }
      node.forEachChild(inspect)
    }
    inspect(source)
  }
})

test('the public SDK type project includes every JavaScript lesson', (t) => {
  const api = new API({ cwd: process.cwd() })
  t.after(() => api.close())
  const project = api.parseConfigFile(resolve('tsconfig.sdk.json'))
  const included = new Set(project.fileNames.map((path) => resolve(path)))
  const lessons = sourceFiles('lessons')
  assert.ok(lessons.length > 0)
  for (const file of lessons) assert.ok(included.has(file), `lesson is missing from public type checks: ${file}`)
  assert.equal(project.options.checkJs, true, 'included JavaScript must actually be checked')
})
