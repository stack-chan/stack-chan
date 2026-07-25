import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DEFAULT_CHARACTER_PROFILE, defineBehavior } from '../modules/interaction/character-profile.js'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'

type RuntimeInteractionModule = typeof import('./runtime-interaction.js')

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackage(hostRoot, 'behavior-engine', resolve(hostRoot, 'modules/interaction/behavior-engine.js'))
  writeAliasPackage(hostRoot, 'face-state', resolve(hostRoot, 'modules/ui/state/face-state.js'))
}

test('RuntimeInteraction samples active Actions at its runtime cadence while dispatch remains immediate', async () => {
  installBareSpecifierPackages()
  const { RuntimeInteraction } = (await import('./runtime-interaction.js')) as RuntimeInteractionModule
  let now = 0
  const appliedAt: number[] = []
  const runtime = new RuntimeInteraction({
    now: () => now,
    random: () => 0.5,
    frameIntervalMs: 50,
    applyFrame: (frame) => appliedAt.push(frame.at),
    applyLegacyEmotion() {},
  })
  runtime.install(
    defineBehavior({
      profile: DEFAULT_CHARACTER_PROFILE,
      actions: {
        reaction: {
          layer: 'interaction',
          durationMs: 500,
          tracks: {
            face: {
              mouth: {
                smile: [{ at: 0, value: 1 }],
              },
            },
          },
        },
      },
      onEvent(event, behavior) {
        if (event.type === 'petted') behavior.play('reaction', { policy: 'restart' })
      },
    }),
  )

  runtime.dispatch({ type: 'petted', strength: 1 })
  assert.deepEqual(appliedAt, [0, 0])

  for (const at of [33, 66, 99, 132, 165, 198, 231]) {
    now = at
    runtime.tick()
  }

  assert.deepEqual(appliedAt, [0, 0, 66, 132, 165, 231])
})
