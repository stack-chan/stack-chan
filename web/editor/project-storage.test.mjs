import assert from 'node:assert/strict'
import test from 'node:test'

import { createVisualProject } from './project-format.mjs'
import { createProjectStorage, migrateLegacyProjectState, serializedProjectStateSize } from './project-storage.mjs'

function createFakeIndexedDB() {
  const databases = new Map()

  function request(result, upgrade = false) {
    const value = { result, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
    queueMicrotask(() => {
      if (upgrade) value.onupgradeneeded?.()
      value.onsuccess?.()
    })
    return value
  }

  return {
    open(name) {
      let database = databases.get(name)
      const upgrade = !database
      if (!database) {
        const stores = new Map()
        database = {
          objectStoreNames: { contains: (storeName) => stores.has(storeName) },
          createObjectStore: (storeName) => stores.set(storeName, new Map()),
          transaction: (storeName) => ({
            objectStore: () => ({
              get: (key) => request(stores.get(storeName).get(key)),
              put: (value, key) => {
                stores.get(storeName).set(key, structuredClone(value))
                return request(undefined)
              },
              delete: (key) => {
                stores.get(storeName).delete(key)
                return request(undefined)
              },
            }),
          }),
          close() {},
        }
        databases.set(name, database)
      }
      return request(database, upgrade)
    },
    seed(name, storeName, key, value) {
      const database = databases.get(name)
      database.transaction(storeName).objectStore().put(value, key)
    },
  }
}

const workspace = { blocks: { languageVersion: 0, blocks: [] } }

test('IndexedDB storage keeps the current project, recent projects, and recovery data', async () => {
  const indexedDB = createFakeIndexedDB()
  const project = createVisualProject({ name: '保存確認', workspace })
  const first = createProjectStorage({ indexedDB, databaseName: 'project-test' })
  await first.saveState({ currentProject: project, projects: [project] })
  await first.saveRecovery({ version: 1, capturedAt: '2026-07-14T00:00:00Z', error: 'broken', raw: '{' })

  const second = createProjectStorage({ indexedDB, databaseName: 'project-test' })
  const state = await second.loadState()
  assert.equal(state.currentProject.name, '保存確認')
  assert.equal(state.projects.length, 1)
  assert.equal((await second.loadRecovery()).raw, '{')

  await second.clearRecovery()
  assert.equal(await second.loadRecovery(), null)
})

test('legacy localStorage records migrate into the versioned state', () => {
  const project = createVisualProject({ name: '旧保存', workspace })
  const state = migrateLegacyProjectState(JSON.stringify(project), JSON.stringify({ version: 1, projects: [project] }))
  assert.equal(state.currentProject.name, '旧保存')
  assert.equal(state.projects[0].name, '旧保存')
})

test('storage accepts state larger than typical localStorage quota without serializing it there', async () => {
  const indexedDB = createFakeIndexedDB()
  const data = 'a'.repeat(6 * 1024 * 1024)
  const project = createVisualProject({
    workspace,
    assets: [
      { path: 'assets/a.txt', encoding: 'utf8', data: data.slice(0, 2 * 1024 * 1024) },
      { path: 'assets/b.txt', encoding: 'utf8', data: data.slice(0, 2 * 1024 * 1024) },
      { path: 'assets/c.txt', encoding: 'utf8', data: data.slice(0, 2 * 1024 * 1024) },
    ],
  })
  const state = { currentProject: project, projects: [project] }
  assert.ok(serializedProjectStateSize(state) > 10 * 1024 * 1024)

  const storage = createProjectStorage({ indexedDB, databaseName: 'large-project-test' })
  await storage.saveState(state)
  assert.equal((await storage.loadState()).currentProject.assets.length, 3)
})

test('corrupt IndexedDB state is retained as an exportable recovery record', async () => {
  const indexedDB = createFakeIndexedDB()
  const storage = createProjectStorage({ indexedDB, databaseName: 'corrupt-project-test' })
  const project = createVisualProject({ workspace })
  await storage.saveState({ currentProject: project, projects: [project] })
  indexedDB.seed('corrupt-project-test', 'project-state', 'current', {
    version: 1,
    currentProject: { format: 'corrupt' },
    projects: [],
  })

  await assert.rejects(storage.loadState(), /未対応のプロジェクト形式/)
  const recovery = await storage.loadRecovery()
  assert.match(recovery.raw, /"format": "corrupt"/)
  assert.match(recovery.error, /未対応のプロジェクト形式/)
})
