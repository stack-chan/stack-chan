import { parseVisualProject, serializeVisualProject } from './project-format.mjs'
import { parseProjectLibrary, serializeProjectLibrary } from './project-library.mjs'

const DEFAULT_DATABASE_NAME = 'stackchan-visual-projects'
const DEFAULT_STORE_NAME = 'project-state'
const STATE_KEY = 'current'
const RECOVERY_KEY = 'recovery'

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
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function normalizeState({ currentProject, projects = [] } = {}) {
  if (!currentProject) return null
  return {
    version: 1,
    currentProject: parseVisualProject(
      typeof currentProject === 'string' ? currentProject : JSON.stringify(currentProject)
    ),
    projects: parseProjectLibrary(typeof projects === 'string' ? projects : serializeProjectLibrary(projects)),
  }
}

function normalizeRecovery(record) {
  if (!record || record.version !== 1) return null
  return {
    version: 1,
    capturedAt: String(record.capturedAt ?? ''),
    error: String(record.error ?? ''),
    raw: String(record.raw ?? ''),
  }
}

function recoveryForCorruptState(record, error) {
  let raw
  try {
    raw = JSON.stringify(record, null, 2)
  } catch {
    raw = String(record)
  }
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    error: String(error?.message ?? error),
    raw,
  }
}

function createMemoryStorage() {
  let state = null
  let recovery = null
  return {
    kind: 'memory',
    async loadState() {
      return state ? structuredClone(state) : null
    },
    async saveState(value) {
      state = normalizeState(value)
    },
    async loadRecovery() {
      return recovery ? structuredClone(recovery) : null
    },
    async saveRecovery(value) {
      recovery = normalizeRecovery(value)
    },
    async clearRecovery() {
      recovery = null
    },
  }
}

export function createProjectStorage({
  indexedDB = globalThis.indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
  storeName = DEFAULT_STORE_NAME,
} = {}) {
  if (!indexedDB?.open) return createMemoryStorage()

  async function withStore(mode, action) {
    const database = await openDatabase({ indexedDB, databaseName, storeName })
    try {
      const transaction = database.transaction(storeName, mode)
      return await action(transaction.objectStore(storeName))
    } finally {
      database.close?.()
    }
  }

  return {
    kind: 'indexedDB',
    async loadState() {
      const record = await withStore('readonly', (store) => requestAsPromise(store.get(STATE_KEY)))
      if (!record) return null
      try {
        return normalizeState(record)
      } catch (error) {
        const recovery = recoveryForCorruptState(record, error)
        try {
          await withStore('readwrite', (store) => requestAsPromise(store.put(recovery, RECOVERY_KEY)))
        } catch {
          // Preserve the original normalization error. The corrupt state stays
          // untouched in IndexedDB even if the separate recovery write fails.
        }
        throw error
      }
    },
    async saveState(value) {
      const state = normalizeState(value)
      await withStore('readwrite', (store) => requestAsPromise(store.put(state, STATE_KEY)))
    },
    async loadRecovery() {
      const record = await withStore('readonly', (store) => requestAsPromise(store.get(RECOVERY_KEY)))
      return normalizeRecovery(record)
    },
    async saveRecovery(value) {
      const recovery = normalizeRecovery(value)
      await withStore('readwrite', (store) => requestAsPromise(store.put(recovery, RECOVERY_KEY)))
    },
    async clearRecovery() {
      await withStore('readwrite', (store) => requestAsPromise(store.delete(RECOVERY_KEY)))
    },
  }
}

export function migrateLegacyProjectState(currentProjectText, libraryText) {
  if (!currentProjectText) return null
  return normalizeState({
    currentProject: parseVisualProject(currentProjectText),
    projects: parseProjectLibrary(libraryText),
  })
}

export function serializedProjectStateSize(state) {
  if (!state) return 0
  return new TextEncoder().encode(
    JSON.stringify({
      currentProject: serializeVisualProject(state.currentProject),
      projects: serializeProjectLibrary(state.projects),
    })
  ).length
}
