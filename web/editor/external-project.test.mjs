import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchExternalProject, projectUrlFromSearch } from './external-project.mjs'

const pageUrl = 'https://stack-chan.github.io/stack-chan/web/editor/'

test('Galleryの同一オリジンブロックプロジェクトを解決する', () => {
  const project = projectUrlFromSearch(
    '?project=https%3A%2F%2Fstack-chan.github.io%2Fstack-chan%2Fweb%2Fmod-gallery%2Fsamples%2Fhello%2Fhello.stackchan-blocks.json',
    pageUrl
  )
  assert.equal(
    project.href,
    'https://stack-chan.github.io/stack-chan/web/mod-gallery/samples/hello/hello.stackchan-blocks.json'
  )
  assert.equal(projectUrlFromSearch('', pageUrl), null)
})

test('外部オリジンとブロック形式でないURLを拒否する', () => {
  assert.throws(
    () => projectUrlFromSearch('?project=https%3A%2F%2Fexample.com%2Fproject.stackchan-blocks.json', pageUrl),
    /別のサイト/
  )
  assert.throws(() => projectUrlFromSearch('?project=..%2Fmanifest.json', pageUrl), /ブロックプロジェクト/)
})

test('取得したプロジェクトを既存の形式検証へ渡す', async () => {
  const project = {
    format: 'tech.stackchan.visual-project',
    version: 1,
    id: 'gallery-test-project',
    name: 'Gallery test',
    target: 'm5stackchan-cores3',
    workspace: { blocks: { languageVersion: 0, blocks: [{ type: 'stackchan_on_start' }] } },
    assets: [],
    settings: { educationalProfile: true, embedAssets: true, faceAsset: null },
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  }
  const result = await fetchExternalProject(
    new URL('https://stack-chan.github.io/project.stackchan-blocks.json'),
    async () => ({
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify(project),
    })
  )
  assert.equal(result.name, 'Gallery test')
  assert.deepEqual(result.workspace, project.workspace)
})
