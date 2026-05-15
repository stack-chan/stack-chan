const DEFAULT_DATABASE_NAME = 'stackchan-wasm-mods'
const DEFAULT_STORE_NAME = 'installed-mods'
const INSTALLED_MOD_KEY = 'installed'

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDatabase({ indexedDB, databaseName, storeName }) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function normalizeBytes(bytes) {
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes)
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return new Uint8Array(bytes ?? [])
}

function createMemoryStorage() {
  let record = null

  return {
    async saveInstalledMod({ name, bytes }) {
      const normalizedBytes = normalizeBytes(bytes)
      record = {
        name,
        bytes: normalizedBytes,
        size: normalizedBytes.byteLength,
        installedAt: Date.now(),
      }
      return { ...record, bytes: new Uint8Array(record.bytes), storage: 'memory' }
    },
    async loadInstalledMod() {
      if (!record) return null
      return { ...record, bytes: new Uint8Array(record.bytes), storage: 'memory' }
    },
    async clearInstalledMod() {
      record = null
    },
  }
}

export function createModStorage({
  indexedDB = globalThis.indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
  storeName = DEFAULT_STORE_NAME,
} = {}) {
  if (!indexedDB?.open) return createMemoryStorage()

  async function withStore(mode, action) {
    const database = await openDatabase({ indexedDB, databaseName, storeName })
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    return action(store)
  }

  return {
    async saveInstalledMod({ name, bytes }) {
      const normalizedBytes = normalizeBytes(bytes)
      const record = {
        name,
        bytes: normalizedBytes.buffer.slice(
          normalizedBytes.byteOffset,
          normalizedBytes.byteOffset + normalizedBytes.byteLength
        ),
        size: normalizedBytes.byteLength,
        installedAt: Date.now(),
      }
      await withStore('readwrite', (store) => requestAsPromise(store.put(record, INSTALLED_MOD_KEY)))
      return { ...record, bytes: new Uint8Array(record.bytes), storage: 'indexedDB' }
    },

    async loadInstalledMod() {
      const record = await withStore('readonly', (store) => requestAsPromise(store.get(INSTALLED_MOD_KEY)))
      if (!record) return null
      const bytes = normalizeBytes(record.bytes)
      return {
        name: record.name,
        bytes,
        size: record.size ?? bytes.byteLength,
        installedAt: record.installedAt,
        storage: 'indexedDB',
      }
    },

    async clearInstalledMod() {
      await withStore('readwrite', (store) => requestAsPromise(store.delete(INSTALLED_MOD_KEY)))
    },
  }
}

export function formatByteSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
