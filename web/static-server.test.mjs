import assert from 'node:assert/strict'
import test from 'node:test'

import { contentType, resolveRequestPath } from './static-server.mjs'

test('static server resolves only decoded paths below its document root', () => {
  assert.equal(resolveRequestPath('/srv/web', '/editor/'), '/srv/web/editor')
  assert.equal(resolveRequestPath('/srv/web', '/editor/tutorial.html?step=1'), '/srv/web/editor/tutorial.html')
  assert.equal(resolveRequestPath('/srv/web', '/%2e%2e/secret'), null)
  assert.equal(resolveRequestPath('/srv/web', '/%00secret'), null)
})

test('static server sends browser-critical MIME types', () => {
  assert.equal(contentType('mc.wasm'), 'application/wasm')
  assert.equal(contentType('editor.mjs'), 'text/javascript; charset=utf-8')
  assert.equal(contentType('asset.bin'), 'application/octet-stream')
})
