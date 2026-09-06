import assert from 'node:assert/strict'
import { makeXsArchive, modDefinition } from '../../firmware/contracts/testing/xsa-fixture.js'
import { describe, it } from 'node:test'

import { createMemoryModStorage, createModStorage, formatByteSize, validateModArchive } from './mod-storage.mjs'

function makeArchive(payload = []) {
  return makeXsArchive({ padding: payload.length })
}

function createFakeIndexedDB() {
  const databases = new Map()

  class FakeObjectStore {
    constructor(records, transaction) {
      this.records = records
      this.transaction = transaction
    }

    complete(result) {
      const request = createRequest(result)
      queueMicrotask(() => this.transaction.oncomplete?.())
      return request
    }

    put(value, key) {
      this.records.set(key, value)
      return this.complete(undefined)
    }

    get(key) {
      return this.complete(this.records.get(key))
    }

    delete(key) {
      this.records.delete(key)
      return this.complete(undefined)
    }
  }

  class FakeTransaction {
    constructor(records) {
      this.records = records
    }

    objectStore() {
      return new FakeObjectStore(this.records, this)
    }
  }

  class FakeDatabase {
    constructor(name) {
      this.name = name
      this.stores = new Map()
      this.objectStoreNames = {
        contains: (storeName) => this.stores.has(storeName),
      }
    }

    createObjectStore(storeName) {
      this.stores.set(storeName, new Map())
    }

    close() {}

    transaction(storeName) {
      return new FakeTransaction(this.stores.get(storeName))
    }
  }

  function createRequest(result, { upgrade = false } = {}) {
    const request = { result, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
    queueMicrotask(() => {
      if (upgrade) request.onupgradeneeded?.({ target: request })
      request.onsuccess?.({ target: request })
    })
    return request
  }

  return {
    open(name) {
      let database = databases.get(name)
      const upgrade = !database
      if (!database) {
        database = new FakeDatabase(name)
        databases.set(name, database)
      }
      return createRequest(database, { upgrade })
    },
  }
}

describe('MOD storage', () => {
  it('preserves the installed MOD when an incompatible replacement is rejected', async () => {
    const storage = createMemoryModStorage()
    const original = makeXsArchive()
    await storage.saveInstalledMod({ name: 'original.xsa', bytes: original })
    for (const bytes of [
      makeXsArchive({ metadata: null }),
      makeXsArchive({ metadata: { ...modDefinition, hostApiVersion: 999 } }),
      makeXsArchive({ metadata: { ...modDefinition, targets: ['m5stackchan-cores3'] } }),
      makeXsArchive({ entrypoints: ['miniapp'] }),
      makeXsArchive({ version: [99, 1, 0] }),
    ]) {
      await assert.rejects(storage.saveInstalledMod({ name: 'rejected.xsa', bytes }))
      assert.equal((await storage.loadInstalledMod()).name, 'original.xsa')
    }
    const source = makeXsArchive().buffer
    await storage.saveInstalledMod({ name: 'copied.xsa', bytes: source })
    new Uint8Array(source).fill(0)
    assert.deepEqual((await storage.loadInstalledMod()).bytes, original)
  })

  it('waits for a transaction commit and rejects an abort even after the put request succeeds', async () => {
    let transaction,
      request,
      closed = 0
    const database = {
      transaction() {
        transaction = {
          objectStore: () => ({
            put() {
              request = {}
              return request
            },
          }),
        }
        return transaction
      },
      close() {
        closed++
      },
    }
    const storage = createModStorage({
      indexedDB: {
        open() {
          const open = { result: database }
          queueMicrotask(() => open.onsuccess())
          return open
        },
      },
    })
    let saved = false
    const saving = storage.saveInstalledMod({ name: 'abort.xsa', bytes: makeXsArchive() }).then(() => {
      saved = true
    })
    const failed = assert.rejects(saving, /aborted/)
    while (!request) await Promise.resolve()
    request.onsuccess()
    await Promise.resolve()
    assert.equal(saved, false)
    transaction.onabort()
    await failed
    assert.equal(closed, 1)
  })

  it('persists an installed .xsa archive through IndexedDB', async () => {
    const indexedDB = createFakeIndexedDB()
    const first = createModStorage({ indexedDB, databaseName: 'mods-test' })
    const bytes = makeArchive([1, 2, 3, 255])

    await first.saveInstalledMod({ name: 'hello.xsa', bytes })

    const second = createModStorage({ indexedDB, databaseName: 'mods-test' })
    const installed = await second.loadInstalledMod()

    assert.equal(installed.name, 'hello.xsa')
    assert.deepEqual(installed.bytes, bytes)
    assert.equal(installed.size, bytes.length)
    assert.equal(installed.storage, 'indexedDB')
  })

  it('clears a saved archive', async () => {
    const storage = createModStorage({ indexedDB: createFakeIndexedDB(), databaseName: 'mods-clear-test' })

    await storage.saveInstalledMod({ name: 'bye.xsa', bytes: makeArchive([7]) })
    await storage.clearInstalledMod()

    assert.equal(await storage.loadInstalledMod(), null)
  })

  it('falls back to memory storage when IndexedDB is unavailable', async () => {
    const storage = createModStorage({ indexedDB: undefined })

    const bytes = makeArchive([9, 8])
    await storage.saveInstalledMod({ name: 'memory.xsa', bytes })
    const installed = await storage.loadInstalledMod()

    assert.equal(installed.name, 'memory.xsa')
    assert.deepEqual(installed.bytes, bytes)
    assert.equal(installed.storage, 'memory')
  })

  it('creates an explicitly session-scoped memory store', async () => {
    const storage = createMemoryModStorage()
    const bytes = makeArchive([4, 2])

    await storage.saveInstalledMod({ name: 'session.xsa', bytes })

    const installed = await storage.loadInstalledMod()
    assert.equal(installed.name, 'session.xsa')
    assert.deepEqual(installed.bytes, bytes)
    assert.equal(installed.size, bytes.byteLength)
    assert.equal(installed.storage, 'memory')
  })

  it('rejects non-XSA bytes and a mismatched declared size', async () => {
    const storage = createModStorage({ indexedDB: undefined })
    await assert.rejects(storage.saveInstalledMod({ name: 'text.xsa', bytes: new Uint8Array([1, 2, 3]) }), /ヘッダー/)
    const archive = makeArchive()
    new DataView(archive.buffer).setUint32(0, 99, false)
    assert.throws(() => validateModArchive(archive), /サイズ/)
  })
})

describe('formatByteSize', () => {
  it('formats byte sizes for MOD status text', () => {
    assert.equal(formatByteSize(0), '0 B')
    assert.equal(formatByteSize(512), '512 B')
    assert.equal(formatByteSize(1536), '1.5 KB')
    assert.equal(formatByteSize(1048576), '1.0 MB')
  })
})
