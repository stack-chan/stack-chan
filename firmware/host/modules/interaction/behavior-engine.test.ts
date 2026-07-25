import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'
import type { ActionFinishedEvent } from './interaction-types.js'

type BehaviorEngineModule = typeof import('./behavior-engine.js')
type CharacterProfileModule = typeof import('./character-profile.js')
type DefaultBehaviorModule = typeof import('../../app/default-behavior/interaction-behavior.js')

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(hostRoot, 'interaction-types', resolve(hostRoot, 'modules/interaction/interaction-types.js'))
  writeAliasPackage(hostRoot, 'character-profile', resolve(hostRoot, 'modules/interaction/character-profile.js'))
  writeAliasPackage(hostRoot, 'behavior-engine', resolve(hostRoot, 'modules/interaction/behavior-engine.js'))
}

async function loadInteractionModules() {
  installBareSpecifierPackages()
  return Promise.all([
    import('./behavior-engine.js') as Promise<BehaviorEngineModule>,
    import('./character-profile.js') as Promise<CharacterProfileModule>,
    import('../../app/default-behavior/interaction-behavior.js') as Promise<DefaultBehaviorModule>,
  ])
}

test('default petting reaction continuously composes face, effect, motion, and lighting', async () => {
  const [{ BehaviorEngine }, , { DEFAULT_BEHAVIOR_DEFINITION }] = await loadInteractionModules()
  let now = 0
  const engine = new BehaviorEngine({
    clock: { now: () => now },
    random: { next: () => 0.5 },
  })
  engine.install(DEFAULT_BEHAVIOR_DEFINITION)
  engine.tick()

  engine.dispatch({ type: 'petted', strength: 1 })
  const start = engine.tick()
  assert.equal(start.face.eyes.left.lowerLid, 0)
  assert.equal(start.face.mouth.smile, 0)
  assert.equal(start.effect.opacity, 0)
  assert.equal(start.motion.active, true)
  assert.equal(start.lighting.active, true)

  now = 150
  const entering = engine.tick()
  assert.ok(entering.face.eyes.left.lowerLid > 0)
  assert.ok(entering.face.eyes.left.lowerLid < 0.7)
  assert.ok(entering.face.mouth.smile > 0)
  assert.ok(entering.face.mouth.smile < 0.85)
  assert.equal(entering.effect.key, 'heart')
  assert.ok(entering.effect.opacity > 0 && entering.effect.opacity < 1)
  assert.ok(entering.motion.yaw > 0)
  assert.ok(entering.lighting.r > 0 && entering.lighting.r < 1)

  now = 5003
  const settled = engine.tick()
  assert.equal(settled.motion.active, false)
  assert.equal(settled.lighting.active, false)
  assert.equal(settled.effect.key, null)
  assert.ok(settled.face.eyes.left.lowerLid < 0.05)
  assert.ok(settled.face.mouth.smile < 0.05)
})

test('BehaviorEngine reuses two output frames without letting Action tracks pollute the smoothed base face', async () => {
  const [{ BehaviorEngine }, , { DEFAULT_BEHAVIOR_DEFINITION }] = await loadInteractionModules()
  let now = 0
  const engine = new BehaviorEngine({
    clock: { now: () => now },
    random: { next: () => 0.5 },
  })
  engine.install(DEFAULT_BEHAVIOR_DEFINITION)

  const first = engine.tick()
  now = 1
  const second = engine.tick()
  now = 2
  const third = engine.tick()
  assert.notEqual(first, second)
  assert.equal(first, third)

  engine.dispatch({ type: 'petted', strength: 1 })
  now = 300
  const reaction = engine.tick()
  assert.ok(reaction.face.eyes.left.lowerLid > 0.5)

  now = 5001
  const recovered = engine.tick()
  assert.ok(recovered.face.eyes.left.lowerLid < 0.05)
})

test('legacy base expression changes use the same continuous face and effect channels', async () => {
  const [{ BehaviorEngine }, { DEFAULT_CHARACTER_PROFILE, defineBehavior }] = await loadInteractionModules()
  let now = 0
  const engine = new BehaviorEngine({
    clock: { now: () => now },
    random: { next: () => 0.5 },
  })
  engine.install(
    defineBehavior({
      profile: DEFAULT_CHARACTER_PROFILE,
      actions: {},
      onEvent() {},
    }),
  )
  engine.tick()

  engine.setBaseExpression('pleased')
  const start = engine.tick()
  assert.equal(start.face.eyes.left.lowerLid, 0)
  assert.equal(start.effect.opacity, 0)

  now = 90
  const entering = engine.tick()
  assert.ok(entering.face.eyes.left.lowerLid > 0 && entering.face.eyes.left.lowerLid < 0.65)
  assert.equal(entering.effect.key, 'heart')
  assert.ok(entering.effect.opacity > 0 && entering.effect.opacity < 1)

  now = 1000
  const settled = engine.tick()
  assert.ok(settled.face.eyes.left.lowerLid > 0.64)
  assert.ok(settled.face.mouth.smile > 0.79)
  assert.ok(settled.effect.opacity > 0.99)
})

test('continuous affect derives face and effect opacity from the same expression', async () => {
  const [{ BehaviorEngine }, { DEFAULT_CHARACTER_PROFILE, defineBehavior }] = await loadInteractionModules()
  let now = 0
  const engine = new BehaviorEngine({
    clock: { now: () => now },
    random: { next: () => 0.5 },
  })
  engine.install(
    defineBehavior({
      profile: DEFAULT_CHARACTER_PROFILE,
      actions: {},
      onEvent(event, behavior) {
        if (event.type === 'petted') behavior.impulseAffect({ valence: 0.8 })
      },
    }),
  )
  engine.tick()
  engine.dispatch({ type: 'petted', strength: 1 })

  const start = engine.tick()
  assert.equal(start.expression, 'pleased')
  assert.equal(start.effect.key, 'heart')
  assert.equal(start.effect.opacity, 0)

  now = 90
  const entering = engine.tick()
  assert.ok(entering.face.eyes.left.lowerLid > 0)
  assert.equal(entering.effect.key, 'heart')
  assert.ok(entering.effect.opacity > 0 && entering.effect.opacity < entering.affect.valence)
})

test('Action policy and completion reasons are observable through the Behavior event interface', async () => {
  const [{ BehaviorEngine }, { DEFAULT_CHARACTER_PROFILE, defineBehavior }] = await loadInteractionModules()
  const finished: ActionFinishedEvent[] = []
  let now = 0
  const definition = defineBehavior({
    profile: DEFAULT_CHARACTER_PROFILE,
    actions: {
      alpha: {
        layer: 'interaction',
        durationMs: 100,
        tracks: {
          face: {
            mouth: {
              smile: [
                { at: 0, value: 0 },
                { at: 100, value: 1 },
              ],
            },
          },
        },
      },
      beta: {
        layer: 'interaction',
        durationMs: 100,
        tracks: {
          face: {
            mouth: {
              smile: [
                { at: 0, value: 0 },
                { at: 100, value: -1 },
              ],
            },
          },
        },
      },
    },
    onEvent(event, behavior) {
      if (event.type === 'action-finished') {
        finished.push({ ...event })
        return
      }
      if (event.type !== 'petted') return
      if (event.strength === 0.1) behavior.play('alpha', { policy: 'replace' })
      if (event.strength === 0.2) behavior.play('beta', { policy: 'replace' })
      if (event.strength === 0.3) behavior.play('beta', { policy: 'restart' })
      if (event.strength === 0.4) behavior.play('alpha', { policy: 'ignore' })
    },
  })
  const engine = new BehaviorEngine({
    clock: { now: () => now },
    random: { next: () => 0.5 },
  })
  engine.install(definition)

  engine.dispatch({ type: 'petted', strength: 0.1 })
  engine.dispatch({ type: 'petted', strength: 0.2 })
  assert.deepEqual(
    finished.map(({ actionId, reason }) => [actionId, reason]),
    [['alpha', 'replaced']],
  )

  engine.dispatch({ type: 'petted', strength: 0.3 })
  engine.dispatch({ type: 'petted', strength: 0.4 })
  assert.deepEqual(
    finished.map(({ actionId, reason }) => [actionId, reason]),
    [
      ['alpha', 'replaced'],
      ['beta', 'restarted'],
    ],
  )

  now = 101
  engine.tick()
  assert.deepEqual(
    finished.map(({ actionId, reason }) => [actionId, reason]),
    [
      ['alpha', 'replaced'],
      ['beta', 'restarted'],
      ['beta', 'completed'],
    ],
  )
})

test('Action layers compose from ambient through conversation to interaction', async () => {
  const [{ BehaviorEngine }, { DEFAULT_CHARACTER_PROFILE, defineBehavior }] = await loadInteractionModules()
  const definition = defineBehavior({
    profile: DEFAULT_CHARACTER_PROFILE,
    actions: {
      ambient: {
        layer: 'ambient',
        mode: 'idle',
        durationMs: 100,
        tracks: {
          face: {
            mouth: { smile: [{ at: 0, value: 0.2 }] },
          },
        },
      },
      conversation: {
        layer: 'conversation',
        mode: 'speak',
        durationMs: 100,
        tracks: {
          face: {
            mouth: { smile: [{ at: 0, value: 0.4 }] },
          },
        },
      },
      reaction: {
        layer: 'interaction',
        mode: 'react',
        durationMs: 100,
        tracks: {
          face: {
            mouth: { smile: [{ at: 0, value: 0.8 }] },
          },
        },
      },
    },
    onEvent(event, behavior) {
      if (event.type === 'petted') {
        behavior.play('ambient', { policy: 'replace' })
        behavior.play('conversation', { policy: 'replace' })
        behavior.play('reaction', { policy: 'replace' })
      }
      if (event.type === 'conversation-phase' && event.phase === 'idle') behavior.stop('interaction')
      if (event.type === 'conversation-phase' && event.phase === 'thinking') behavior.stop('conversation')
    },
  })
  const engine = new BehaviorEngine({
    clock: { now: () => 0 },
    random: { next: () => 0.5 },
  })
  engine.install(definition)
  engine.dispatch({ type: 'petted', strength: 1 })

  const frame = engine.tick()
  assert.equal(frame.face.mouth.smile, 0.8)
  assert.equal(frame.mode, 'react')

  engine.dispatch({ type: 'conversation-phase', phase: 'idle' })
  assert.equal(engine.tick().face.mouth.smile, 0.4)
  assert.equal(engine.tick().mode, 'speak')

  engine.dispatch({ type: 'conversation-phase', phase: 'thinking' })
  assert.equal(engine.tick().face.mouth.smile, 0.2)
  assert.equal(engine.tick().mode, 'idle')
})

test('speech envelope has attack, hold, and release and remains a mouth-open floor', async () => {
  const [{ BehaviorEngine }, { DEFAULT_CHARACTER_PROFILE, defineBehavior }] = await loadInteractionModules()
  let now = 0
  const engine = new BehaviorEngine({
    clock: { now: () => now },
    random: { next: () => 0.5 },
  })
  engine.install(
    defineBehavior({
      profile: DEFAULT_CHARACTER_PROFILE,
      actions: {},
      onEvent() {},
    }),
  )
  engine.tick()
  engine.setSignal({ type: 'speech-envelope', value: 1 })

  now = 40
  const attack = engine.tick()
  assert.ok(attack.speechEnvelope > 0 && attack.speechEnvelope < 1)
  assert.equal(attack.face.mouth.open, attack.speechEnvelope)

  now = 150
  const held = engine.tick()
  assert.ok(held.speechEnvelope > attack.speechEnvelope)

  now = 200
  const released = engine.tick()
  assert.ok(released.speechEnvelope < held.speechEnvelope)
  assert.equal(released.face.mouth.open, released.speechEnvelope)
})

test('finite relative motion Actions must return every controlled axis to zero', async () => {
  const [{ BehaviorEngine }, { DEFAULT_CHARACTER_PROFILE, defineBehavior }] = await loadInteractionModules()
  const engine = new BehaviorEngine({
    clock: { now: () => 0 },
    random: { next: () => 0.5 },
  })
  const invalidDefinition = defineBehavior({
    profile: DEFAULT_CHARACTER_PROFILE,
    actions: {
      unsafe: {
        layer: 'interaction',
        durationMs: 100,
        tracks: {
          motion: {
            yaw: [
              { at: 0, value: 0.5 },
              { at: 100, value: 0 },
            ],
          },
        },
      },
    },
    onEvent() {},
  })

  assert.throws(() => engine.install(invalidDefinition), /must start and end at zero/)
})
