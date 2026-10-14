/// <reference path="../../node_modules/@moddable/typings/embedded/storage/files.d.ts" />

import type { Directory } from 'embedded:storage/files'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listModFiles, readModFile } from './mod-files.js'

function fakeFiles(
  options: { size?: number; readSize?: number; readThrows?: boolean; file?: boolean; statusThrows?: boolean } = {},
) {
  const calls: string[] = []
  const size = options.size ?? 20
  const files = {
    openDirectory({ path }: { path: string }) {
      calls.push(`directory:${path}`)
      return {
        *scan() {
          yield* [
            'demo.xsa',
            'A_-2.xsa',
            '../bad.xsa',
            'bad/path.xsa',
            '.xsa',
            'UPPER.XSA',
            'directory.xsa',
            `${'a'.repeat(65)}.xsa`,
          ]
        },
        status(name: string) {
          if (options.statusThrows) throw new Error('removed card')
          return { isFile: () => name !== 'directory.xsa' }
        },
        close() {
          calls.push('close-directory')
        },
      }
    },
    openFile({ path, mode }: { path: string; mode: string }) {
      calls.push(`file:${path}:${mode}`)
      return {
        status() {
          if (options.statusThrows) throw new Error('removed card')
          return { size, isFile: () => options.file !== false }
        },
        read(count: number, position: number) {
          calls.push(`read:${count}:${position}`)
          if (options.readThrows) throw new Error('read failed')
          return new ArrayBuffer(options.readSize ?? count)
        },
        close() {
          calls.push('close-file')
        },
      }
    },
  } as unknown as Directory
  return { files, calls }
}

test('lists only bounded MOD basenames and regular files, closes directory', () => {
  const { files, calls } = fakeFiles()
  assert.deepEqual(listModFiles(files), ['demo.xsa', 'A_-2.xsa'])
  assert.deepEqual(calls, ['directory:mods', 'close-directory'])
})

test('rejects paths and invalid limits before opening files', () => {
  const { files, calls } = fakeFiles()
  for (const name of [
    '../demo.xsa',
    '/demo.xsa',
    'a/b.xsa',
    'a\\b.xsa',
    '.xsa',
    'demo.XSA',
    `${'a'.repeat(65)}.xsa`,
    'demo.xsa\n',
  ]) {
    assert.throws(() => readModFile(files, name, 20))
  }
  for (const limit of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => readModFile(files, 'demo.xsa', limit))
  assert.deepEqual(calls, [])
})

test('reads only a checked length, accepts exact partition limit, closes file', () => {
  const { files, calls } = fakeFiles()
  assert.equal(readModFile(files, 'demo.xsa', 20).byteLength, 20)
  assert.deepEqual(calls, ['file:mods/demo.xsa:r', 'read:20:0', 'close-file'])
})

test('rejects empty, oversized and non-file entries before reading', () => {
  for (const options of [{ size: 0 }, { size: 21 }, { file: false }]) {
    const { files, calls } = fakeFiles(options)
    assert.throws(() => readModFile(files, 'demo.xsa', 20))
    assert.deepEqual(calls, ['file:mods/demo.xsa:r', 'close-file'])
  }
})

test('rejects truncated reads and closes files after IO errors', () => {
  for (const options of [{ readSize: 19 }, { readThrows: true }, { statusThrows: true }]) {
    const { files, calls } = fakeFiles(options)
    assert.throws(() => readModFile(files, 'demo.xsa', 20))
    assert.equal(calls.at(-1), 'close-file')
  }
  const { files, calls } = fakeFiles({ statusThrows: true })
  assert.throws(() => listModFiles(files))
  assert.equal(calls.at(-1), 'close-directory')
})
