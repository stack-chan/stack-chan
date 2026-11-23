import assert from 'node:assert/strict'
import test from 'node:test'
import { GuruguruAvatar } from './avatar.js'

test('touch maps all nine directions and clamps edges', () => {
  const avatar = new GuruguruAvatar()
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      avatar.trackFace(col * 100 + 50, row * 100 + 50, 300, 300)
      assert.equal(avatar.direction, row * 3 + col)
    }
  avatar.trackFace(-20, 400, 300, 300)
  assert.equal(avatar.direction, 6)
})
test('blink reopens, and lip level stops outside speak', () => {
  const avatar = new GuruguruAvatar({ random: () => 0 })
  avatar.tick(2000)
  assert.equal(avatar.eyeOpen, false)
  avatar.tick(120)
  assert.equal(avatar.eyeOpen, true)
  avatar.setState('speak')
  avatar.setLevel(0.1)
  assert.ok(avatar.mouth > 0)
  avatar.setState('idle')
  assert.equal(avatar.mouth, 0)
  avatar.setLevel(1)
  assert.equal(avatar.mouth, 0)
  avatar.setExpression('happy')
  assert.equal(avatar.expression, 'happy')
})
