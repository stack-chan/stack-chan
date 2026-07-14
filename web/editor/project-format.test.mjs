import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VISUAL_PROJECT_FORMAT,
  createVisualProject,
  parseVisualProject,
  projectFileName,
  serializeVisualProject,
  MAX_ASSET_BYTES,
  MAX_PROJECT_JSON_BYTES,
} from './project-format.mjs'

const workspace = { blocks: { languageVersion: 0, blocks: [] } }

test('visual project round-trips without losing the workspace contract', () => {
  const project = createVisualProject({ name: ' 表情 / テスト ', target: 'simulator', workspace })
  const restored = parseVisualProject(serializeVisualProject(project))
  assert.equal(restored.format, VISUAL_PROJECT_FORMAT)
  assert.equal(restored.name, '表情 テスト')
  assert.equal(restored.id, project.id)
  assert.equal(restored.target, 'simulator')
  assert.deepEqual(restored.workspace, workspace)
  assert.equal(projectFileName(restored), '表情-テスト.stackchan-blocks.json')
})

test('legacy Blockly-only JSON is migrated into a versioned project', () => {
  const restored = parseVisualProject(JSON.stringify(workspace))
  assert.equal(restored.format, VISUAL_PROJECT_FORMAT)
  assert.deepEqual(restored.workspace, workspace)
  assert.match(restored.id, /^[A-Za-z0-9._-]{8,128}$/)
})

test('invalid project versions are rejected with an actionable error', () => {
  const project = createVisualProject({ workspace })
  project.version = 99
  assert.throws(() => parseVisualProject(JSON.stringify(project)), /未対応のプロジェクトバージョン/)
})

test('oversized embedded assets are rejected before they reach the builder', () => {
  assert.throws(
    () =>
      createVisualProject({
        workspace,
        assets: [
          {
            path: 'assets/large.bin',
            encoding: 'base64',
            data: 'A'.repeat(4 * Math.ceil((MAX_ASSET_BYTES + 1) / 3)),
          },
        ],
      }),
    /上限/
  )
})

test('project creation rejects more than the supported number of assets', () => {
  const assets = Array.from({ length: 33 }, (_, index) => ({
    path: `assets/${index}.txt`,
    mediaType: 'text/plain',
    encoding: 'utf8',
    data: '',
  }))
  assert.throws(() => createVisualProject({ workspace, assets }), /アセット数が上限 32/)
})

test('asset paths reject traversal but permit dots inside a filename', () => {
  assert.doesNotThrow(() =>
    createVisualProject({ workspace, assets: [{ path: 'assets/face..draft.json', encoding: 'utf8', data: '{}' }] })
  )
  for (const path of ['/absolute.json', 'assets/../secret', 'assets\\secret', 'C:/secret']) {
    assert.throws(
      () => createVisualProject({ workspace, assets: [{ path, encoding: 'utf8', data: '{}' }] }),
      /パスが不正/
    )
  }
})

test('serialization enforces the whole-project limit and rejects malformed base64', () => {
  assert.throws(
    () =>
      createVisualProject({
        workspace,
        assets: [{ path: 'assets/bad.bin', encoding: 'base64', data: 'not base64!' }],
      }),
    /Base64/
  )

  const data = 'a'.repeat(MAX_ASSET_BYTES)
  const project = createVisualProject({
    workspace,
    assets: Array.from({ length: 4 }, (_, index) => ({
      path: `assets/${index}.txt`,
      encoding: 'utf8',
      data,
    })),
  })
  assert.throws(() => serializeVisualProject(project), new RegExp(String(MAX_PROJECT_JSON_BYTES)))
})

test('asset paths are unique and a selected face must exist in the project', () => {
  const asset = { path: 'assets/face.stackchan-face.json', encoding: 'utf8', data: '{}' }
  assert.throws(() => createVisualProject({ workspace, assets: [asset, asset] }), /同じパス/)
  assert.throws(
    () => createVisualProject({ workspace, settings: { faceAsset: asset.path } }),
    /顔アセットがassetsにありません/
  )
})
