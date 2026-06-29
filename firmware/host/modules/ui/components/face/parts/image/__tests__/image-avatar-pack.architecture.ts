import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('ImageAvatarLite sample MOD owns its pack assets and license notice', () => {
  const modSource = readFileSync('mods/examples/image_avatar_lite/image-avatar-lite-packs.js', 'utf8')
  assert.match(modSource, /image-avatar-lite-slime/)
  assert.match(modSource, /image-avatar-lite-transparent\.png/)

  const notice = readFileSync('mods/examples/image_avatar_lite/LICENSE-M5Core2ImageAvatarLite_AI.txt', 'utf8')
  assert.match(notice, /MIT License/)
  assert.match(notice, /Copyright \(c\) 2021 Takao Akaki/)
})
