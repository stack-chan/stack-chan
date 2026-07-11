import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assembleModSource, COLOR_OPTIONS, EMOTION_OPTIONS, escapeSingleQuoted } from './blocks.mjs'

test('escapeSingleQuoted keeps a field_input value a valid single-quoted literal', () => {
  assert.equal(escapeSingleQuoted('primary'), 'primary')
  assert.equal(escapeSingleQuoted("a'b"), "a\\'b")
  assert.equal(escapeSingleQuoted('a\\b'), 'a\\\\b')
  // the escaped value must parse as the original string inside single quotes
  for (const raw of ['primary', "a'b", 'a\\b', "x'\\y"]) {
    // eslint-disable-next-line no-eval
    assert.equal(eval(`'${escapeSingleQuoted(raw)}'`), raw)
  }
})

test('assembleModSource wraps the body in onContextCreated', () => {
  const source = assembleModSource('robot.face.setEmotion(Emotion.HAPPY)\n')
  assert.match(source, /export async function onContextCreated\(robot\) \{/)
  assert.match(source, /^  robot\.face\.setEmotion\(Emotion\.HAPPY\)$/m)
  assert.match(source, /import \{ Emotion \} from 'face-state'/)
})

test('assembleModSource only imports what the body uses', () => {
  const plain = assembleModSource('robot.ui.hideBalloon()\n')
  assert.doesNotMatch(plain, /import/)

  const withTimer = assembleModSource('Timer.repeat(() => {}, 1000)\n')
  assert.match(withTimer, /import Timer from 'timer'/)
  assert.doesNotMatch(withTimer, /stackchan-util/)

  const withUtils = assembleModSource('await wait(randomBetween(1, 2))\n')
  assert.match(withUtils, /import \{ randomBetween, wait \} from 'stackchan-util'/)
})

test('assembleModSource includes the hexToRgb helper when used', () => {
  const source = assembleModSource("robot.face.setColor('primary', ...hexToRgb('#ff0000'))\n")
  assert.match(source, /function hexToRgb\(hex\)/)
  const helperIndex = source.indexOf('function hexToRgb')
  const bodyIndex = source.indexOf('export async function onContextCreated')
  assert.ok(helperIndex < bodyIndex, 'helper must be defined before the hook')
})

test('assembleModSource emits valid JavaScript', async () => {
  const source = assembleModSource(
    "robot.face.setColor('primary', ...hexToRgb('#30e0ff'))\n" +
      'Timer.repeat(() => {\n' +
      "  void (async () => {\n    await wait(randomBetween(100, 200))\n    robot.face.setEmotion(Emotion.HAPPY)\n  })().catch((error) => trace('x\\n'))\n" +
      '}, 1000)\n'
  )
  // module-level syntax check: rewrite imports so plain Function() can parse it
  const stripped = source.replace(/^import .*$/gm, '').replace('export async function', 'async function')
  assert.doesNotThrow(() => new Function(stripped))
})

test('block option tables are well-formed', () => {
  for (const [label, value] of EMOTION_OPTIONS) {
    assert.ok(label.length > 0)
    assert.match(value, /^[A-Z]+$/)
  }
  for (const [label, value] of COLOR_OPTIONS) {
    assert.ok(label.length > 0)
    assert.match(value, /^#[0-9a-f]{6}$/)
  }
})
