import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from './node-alias-package.js'

test('new subpaths remain loadable after Node has cached an alias package and preserve its root export', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stackchan-alias-'))
  try {
    const target = join(root, 'target.mjs')
    const consumer = join(root, 'consumer.mjs')
    writeFileSync(target, 'export const value = 42;')
    writeFileSync(consumer, 'export const load = (name) => import(name);')
    writeAliasPackage(root, 'fixture', target)
    const { load } = await import(pathToFileURL(consumer).href)
    assert.equal((await load('fixture')).value, 42)
    writeAliasPackageSubpath(root, 'fixture', 'first', target)
    assert.equal((await load('fixture/first')).value, 42)
    writeAliasPackageSubpath(root, 'fixture', 'nested/later', target)
    assert.equal((await load('fixture/nested/later')).value, 42)
    assert.equal((await load('fixture')).value, 42)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
