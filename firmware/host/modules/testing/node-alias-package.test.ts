import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { writeAliasPackage, writeAliasPackageSubpath } from './node-alias-package.js'

for (const subpath of ['', 'nested/value'])
  test(`publishing a closer ${subpath ? 'subpath' : 'root'} alias never exposes a partial package to another process`, (t) => {
    const root = fs.mkdtempSync(resolve(tmpdir(), 'stackchan-alias-publication-'))
    const child = resolve(root, 'app')
    const target = resolve(root, 'target.mjs')
    fs.mkdirSync(child)
    fs.writeFileSync(target, 'export const value = 42;\nexport default value;\n')
    const entry = resolve(child, 'entry.mjs')
    fs.writeFileSync(
      entry,
      `import value, { value as named } from 'shared-alias${subpath ? `/${subpath}` : ''}';\nif (value !== 42 || named !== 42) throw new Error('wrong alias');\n`,
    )
    function publish(directory: string) {
      if (subpath) writeAliasPackageSubpath(directory, 'shared-alias', subpath, target, { hasDefaultExport: true })
      else writeAliasPackage(directory, 'shared-alias', target, { hasDefaultExport: true })
    }
    publish(root)
    let observations = 0
    function observe() {
      const reader = spawnSync(process.execPath, [entry], { encoding: 'utf8' })
      assert.equal(reader.status, 0, reader.stderr)
      observations++
    }
    for (const method of ['mkdirSync', 'writeFileSync', 'renameSync'] as const) {
      const original = fs[method]
      t.mock.method(fs, method, (...args: unknown[]) => {
        const result = Reflect.apply(original, fs, args)
        observe()
        return result
      })
    }
    syncBuiltinESMExports()
    try {
      publish(child)
      assert.ok(observations > 0)
      observe()
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

test('competing first publishers complete their requested alias without leaving staging directories', (t) => {
  const root = fs.mkdtempSync(resolve(tmpdir(), 'stackchan-alias-competing-'))
  const first = resolve(root, 'first.mjs')
  const second = resolve(root, 'second.mjs')
  fs.writeFileSync(first, 'export const value = 1;\n')
  fs.writeFileSync(second, 'export const value = 2;\n')
  const packageRoot = resolve(root, 'node_modules', 'shared-alias')
  let competed = false
  const rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (destination === packageRoot && !competed) {
      competed = true
      writeAliasPackage(root, 'shared-alias', second)
    }
    rename(source, destination)
  })
  syncBuiltinESMExports()
  try {
    writeAliasPackage(root, 'shared-alias', first)
    assert.equal(competed, true)
    assert.deepEqual(fs.readdirSync(resolve(root, 'node_modules')), ['shared-alias'])
    const entry = resolve(root, 'entry.mjs')
    fs.writeFileSync(entry, "import { value } from 'shared-alias';\nif (value !== 1) throw new Error('wrong alias');\n")
    const reader = spawnSync(process.execPath, [entry], { encoding: 'utf8' })
    assert.equal(reader.status, 0, reader.stderr)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('identical concurrent publishers keep an existing alias continuously readable', async () => {
  const root = fs.mkdtempSync(resolve(dirname(fileURLToPath(import.meta.url)), 'alias-concurrent-'))
  const target = resolve(root, 'target.mjs')
  fs.writeFileSync(target, 'export const value = 42;\n')
  writeAliasPackage(root, 'shared-alias', target)
  const entry = resolve(root, 'node_modules/shared-alias/index.js')
  const expected = fs.readFileSync(entry, 'utf8')
  const state = new SharedArrayBuffer(4)
  const worker = new Worker(
    `const { workerData } = require('node:worker_threads');
    const state = new Int32Array(workerData.state);
    (async () => {
      try {
        const { writeAliasPackage } = await import(workerData.helper);
        Atomics.store(state, 0, 1);
        for (let index = 0; index < 200; index++) writeAliasPackage(workerData.root, 'shared-alias', workerData.target);
      } finally {
        Atomics.store(state, 0, 2);
      }
    })().catch(error => { throw error; });`,
    {
      eval: true,
      workerData: { root, target, state, helper: new URL('./node-alias-package.js', import.meta.url).href },
    },
  )
  const exited = new Promise<number>((resolve, reject) => {
    worker.on('exit', resolve)
    worker.on('error', reject)
  })
  let missing = 0
  let incomplete = 0
  const gate = new Int32Array(state)
  const deadline = Date.now() + 30000
  try {
    while (Atomics.load(gate, 0) !== 2 && Date.now() < deadline) {
      try {
        if (fs.readFileSync(entry, 'utf8') !== expected) incomplete++
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        missing++
      }
    }
    assert.equal(Atomics.load(gate, 0), 2, 'publisher did not finish')
    assert.equal(await exited, 0)
    assert.equal(missing, 0, 'an existing alias disappeared while another process published identical contents')
    assert.equal(incomplete, 0)
  } finally {
    await worker.terminate()
    await exited.catch(() => {})
    fs.rmSync(root, { recursive: true, force: true })
  }
})
