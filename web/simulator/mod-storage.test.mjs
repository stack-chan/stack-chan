import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createModStorage, formatByteSize } from './mod-storage.mjs'

function createFakeIndexedDB() {
  const databases = new Map()

  class FakeObjectStore {
    constructor(records) {
      this.records = records
    }

    put(value, key) {
      this.records.set(key, value)
      return createRequest(undefined)
    }

    get(key) {
      return createRequest(this.records.get(key))
    }

    delete(key) {
      this.records.delete(key)
      return createRequest(undefined)
    }
  }

  class FakeTransaction {
    constructor(records) {
      this.records = records
    }

    objectStore() {
      return new FakeObjectStore(this.records)
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
  it('persists an installed .xsa archive through IndexedDB', async () => {
    const indexedDB = createFakeIndexedDB()
    const first = createModStorage({ indexedDB, databaseName: 'mods-test' })
    const bytes = new Uint8Array([1, 2, 3, 255])

    await first.saveInstalledMod({ name: 'hello.xsa', bytes })

    const second = createModStorage({ indexedDB, databaseName: 'mods-test' })
    const installed = await second.loadInstalledMod()

    assert.equal(installed.name, 'hello.xsa')
    assert.deepEqual(Array.from(installed.bytes), [1, 2, 3, 255])
    assert.equal(installed.size, 4)
    assert.equal(installed.storage, 'indexedDB')
  })

  it('clears a saved archive', async () => {
    const storage = createModStorage({ indexedDB: createFakeIndexedDB(), databaseName: 'mods-clear-test' })

    await storage.saveInstalledMod({ name: 'bye.xsa', bytes: new Uint8Array([7]) })
    await storage.clearInstalledMod()

    assert.equal(await storage.loadInstalledMod(), null)
  })

  it('falls back to memory storage when IndexedDB is unavailable', async () => {
    const storage = createModStorage({ indexedDB: undefined })

    await storage.saveInstalledMod({ name: 'memory.xsa', bytes: new Uint8Array([9, 8]) })
    const installed = await storage.loadInstalledMod()

    assert.equal(installed.name, 'memory.xsa')
    assert.deepEqual(Array.from(installed.bytes), [9, 8])
    assert.equal(installed.storage, 'memory')
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
