import assert from 'node:assert/strict'
import test from 'node:test'
import { createResponseExpressionController, expressionForResponse } from './response-expression.js'

test('clear response cues select joy, sympathy, or neutral without additional API calls', () => {
  assert.equal(expressionForResponse('合格おめでとう！'), 'happy')
  assert.equal(expressionForResponse('教えてくれてありがとう。'), 'happy')
  assert.equal(expressionForResponse('それはつらいですね。話してくれてありがとう。'), 'sad')
  assert.equal(expressionForResponse('お悔やみ申し上げます。'), 'sad')
  assert.equal(expressionForResponse('明日は午前9時からです。'), 'neutral')
  assert.equal(expressionForResponse('Wonderful!'), 'happy')
  assert.equal(expressionForResponse('I am sorry to hear that.'), 'sad')
})

test('common negations and unsupported inputs do not produce misleading expressions', () => {
  for (const text of ['嬉しくないです。', '悲しくありません。', '楽しいとは限らない。', '', null, {}]) {
    assert.equal(expressionForResponse(text), 'neutral')
  }
  assert.equal(expressionForResponse(`${'a'.repeat(512)}おめでとう`), 'neutral')
})

test('one complete Muse response chooses once; stale output and level events are ignored', () => {
  const changes = []
  const controller = createResponseExpressionController((value) => changes.push(value))
  controller.handle({ type: 'output.text', delta: 'おめでとう' })
  assert.deepEqual(changes, [])
  controller.handle({ type: 'turn.started' })
  controller.handle({ type: 'output.text', delta: ' ' })
  controller.handle({ type: 'output.text', delta: 'おめでとう' })
  controller.handle({ type: 'output.text', delta: '悲しい' })
  controller.handle({ type: 'output.level', level: 1 })
  assert.deepEqual(changes, ['happy'])
  controller.handle({ type: 'turn.ended' })
  controller.handle({ type: 'output.text', delta: '悲しい' })
  assert.deepEqual(changes, ['happy', 'neutral'])
})

test('failure, session shutdown, and a new turn clear the previous expression', () => {
  for (const type of ['error', 'session.ended', 'turn.started']) {
    const changes = []
    const controller = createResponseExpressionController((value) => changes.push(value))
    controller.handle({ type: 'turn.started' })
    controller.handle({ type: 'output.text', delta: '残念です。' })
    controller.handle({ type })
    controller.reset()
    assert.deepEqual(changes, ['sad', 'neutral'])
  }
})

test('quoted, truncated, and commonly negated cues prefer neutral', () => {
  for (const text of [
    '「おめでとう」と書いてあります。',
    '『悲しい』という言葉です。',
    '“Wonderful” is an example.',
    '「おめでとう',
    '嬉しくはない。',
    '悲しくはありません。',
    '残念ではないです。',
    'Not wonderful.',
  ]) {
    assert.equal(expressionForResponse(text), 'neutral')
  }
  assert.equal(expressionForResponse('「悲しい」と話してくれてありがとう。'), 'neutral')
})

test('partial text chunks are not guessed or concatenated into an emotion', () => {
  const changes = []
  const controller = createResponseExpressionController((value) => changes.push(value))
  controller.handle({ type: 'turn.started' })
  controller.handle({ type: 'output.text', delta: 'おめ' })
  controller.handle({ type: 'output.text', delta: 'でとう' })
  controller.handle({ type: 'turn.ended', status: 'cancelled' })
  assert.deepEqual(changes, [])
})
