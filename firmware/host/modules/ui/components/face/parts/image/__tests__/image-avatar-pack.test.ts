import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../../../../../../testing/node-alias-package.js'
import { Emotion } from '../../../../../state/face-state.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../..')
for (const root of [resolve(hostRoot, 'modules'), hostRoot, resolve(hostRoot, '..')])
  for (const name of ['app', 'errors'])
    writeAliasPackageSubpath(root, 'stackchan', name, resolve(hostRoot, `../sdk/${name}.js`))
const { EMOTIONS } = await import('../../../../../../../../sdk/app.js')
const { snapshotImageAvatarPack, STACKCHAN_DEMO_IMAGE_AVATAR_PACK: demo } = await import('../image-avatar-pack.js')
const { frameIndexForRatio, resolveExpressionName } = await import('../image-avatar-state.js')

test('an active avatar owns a deeply frozen copy of every expression and emotion mapping', () => {
  const input = JSON.parse(JSON.stringify(demo))
  const pack = snapshotImageAvatarPack(input)
  input.emotionMap.happy = 'angry'
  input.expressions.happy.eyes.left.frameCount = 1
  input.expressions.happy.head.x = 900
  assert.equal(pack.emotionMap.happy, demo.emotionMap.happy)
  assert.equal(pack.expressions.happy.eyes.left.frameCount, demo.expressions.happy.eyes.left.frameCount)
  assert.equal(pack.expressions.happy.head.x, demo.expressions.happy.head.x)
  const assertFrozen = (value: unknown): void => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value))
      for (const nested of Object.values(value)) assertFrozen(nested)
    }
  }
  assertFrozen(pack)
})

test('SDK emotion names and the host face states select the same avatar expressions', () => {
  const pairs = [
    [Emotion.NEUTRAL, 'neutral'],
    [Emotion.ANGRY, 'angry'],
    [Emotion.SAD, 'sad'],
    [Emotion.HAPPY, 'happy'],
    [Emotion.SLEEPY, 'sleepy'],
    [Emotion.DOUBTFUL, 'doubt'],
    [Emotion.COLD, 'cold'],
    [Emotion.HOT, 'hot'],
  ] as const
  const pack = snapshotImageAvatarPack(demo)
  assert.equal(pairs.length, EMOTIONS.length)
  for (const [internal, name] of pairs) {
    assert.equal(EMOTIONS[internal], name)
    assert.equal(resolveExpressionName(pack, internal), pack.emotionMap[name] ?? pack.defaultExpression)
  }
  assert.equal(resolveExpressionName(pack, Emotion.DOUBTFUL), pack.defaultExpression)
})

test('invalid avatar data fails before it can become a live face', () => {
  const cases = [
    null,
    undefined,
    'stackchan-demo',
    {},
    ...[0, -1, NaN, 1.5, 321].map((width) => ({ ...demo, width })),
    { ...demo, height: 241 },
    { ...demo, defaultExpression: 'missing' },
    { ...demo, expressions: {} },
    {
      ...demo,
      expressions: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`face-${i}`, demo.expressions.normal])),
    },
    ...[{ HAPPY: 'happy' }, { 3: 'happy' }, { happy: 'missing' }].map((emotionMap) => ({ ...demo, emotionMap })),
  ]
  for (const edit of [
    { frameCount: 0 },
    { frameCount: 33 },
    { frameCount: 8, width: 1024 },
    { x: Infinity },
    { height: 0 },
    { texture: '../outside.png' },
    { color: 'red' },
  ]) {
    const input = JSON.parse(JSON.stringify(demo))
    Object.assign(input.expressions.normal.eyes.left, edit)
    cases.push(input)
  }
  for (const input of cases) assert.throws(() => snapshotImageAvatarPack(input), { code: 'INVALID_ARGUMENT' })
})

test('sprite frames stay within their strip for closed, open, and out-of-range ratios', () => {
  assert.equal(frameIndexForRatio(-0.2, 4), 0)
  assert.equal(frameIndexForRatio(0.66, 4), 2)
  assert.equal(frameIndexForRatio(1.5, 4), 3)
  assert.equal(frameIndexForRatio(1, 1), 0)
})
