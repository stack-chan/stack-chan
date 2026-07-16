import assert from 'node:assert/strict'
import test from 'node:test'

import { GUIDE_NAVIGATION_ITEMS, navigationItemForPath, TOOL_NAVIGATION_ITEMS } from './tool-navigation.mjs'

test('tool navigation exposes every primary web surface in the left drawer', () => {
  assert.deepEqual(
    TOOL_NAVIGATION_ITEMS.map((item) => item.id),
    ['home', 'flash', 'preference', 'simulator', 'editor', 'face-editor']
  )
  assert.deepEqual(
    GUIDE_NAVIGATION_ITEMS.map((item) => item.id),
    ['tutorial']
  )
})

test('tool navigation selects the exact surface instead of every parent path', () => {
  assert.equal(navigationItemForPath('/stack-chan/'), 'home')
  assert.equal(navigationItemForPath('/stack-chan/editor/'), 'editor')
  assert.equal(navigationItemForPath('/stack-chan/editor/tutorial.html'), 'tutorial')
  assert.equal(navigationItemForPath('/stack-chan/face-editor/index.html'), 'face-editor')
})
