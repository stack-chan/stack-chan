import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

type RobotChatToolsModule = typeof import('../robot-chat-tools.js')

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(hostRoot, 'face-state', resolve(hostRoot, 'modules/ui/state/face-state.js'))
  writeAliasPackage(hostRoot, 'timer', resolve(hostRoot, 'modules/testing/fakes/timer.js'), { hasDefaultExport: true })
}

type RobotFixture = ReturnType<typeof createRobot>

function createRobot(options: { led?: boolean; sample?: object } = {}) {
  const calls = {
    emotions: [] as number[],
    poses: [] as { position: { x: number; y: number; z: number }; rotation: { y: number; p: number; r: number } }[],
    torque: [] as boolean[],
    lookAway: 0,
    lights: [] as unknown[][],
    tones: [] as { hz: number; duration: number; volume?: number }[],
  }
  const body = {
    position: { x: 0.01, y: 0.02, z: 0.03 },
    rotation: { y: 0.1, p: -0.2, r: 0.03 },
  }
  const led = options.led === false ? {} : { head: {} }
  const robot = {
    face: {
      setEmotion: (emotion: number) => calls.emotions.push(emotion),
    },
    motion: {
      pose: { body },
      lookAway: () => {
        calls.lookAway += 1
      },
      setTorque: async (enabled: boolean) => {
        calls.torque.push(enabled)
      },
      setPose: async (pose: (typeof calls.poses)[number]) => {
        calls.poses.push(structuredClone(pose))
        body.position = { ...pose.position }
        body.rotation = { ...pose.rotation }
      },
    },
    lighting: {
      led,
      lightOn: (...args: unknown[]) => calls.lights.push(['on', ...args]),
      lightOff: (...args: unknown[]) => calls.lights.push(['off', ...args]),
      lightBlink: (...args: unknown[]) => calls.lights.push(['blink', ...args]),
      lightRainbow: (...args: unknown[]) => calls.lights.push(['rainbow', ...args]),
    },
    audio: {
      tone: async (hz: number, duration: number, volume?: number) => {
        calls.tones.push({ hz, duration, volume })
      },
    },
    input: {
      imu: options.sample === undefined ? undefined : { lastSample: structuredClone(options.sample) },
    },
  }
  return { robot, calls, body }
}

async function loadTools(fixture: RobotFixture, options: Record<string, unknown> = {}) {
  installBareSpecifierPackages()
  const { createRobotChatTools } = (await import('../robot-chat-tools.js')) as RobotChatToolsModule
  return createRobotChatTools(fixture.robot as never, { delay: async () => {}, ...options })
}

test('robot chat tools expose nested JSON schemas and omit unsupported LEDs', async () => {
  const withLed = await loadTools(createRobot())
  assert.deepEqual(Object.keys(withLed).sort(), [
    'get_robot_status',
    'play_melody',
    'play_motion',
    'set_emotion',
    'set_led',
  ])
  assert.deepEqual(withLed.play_motion.parameters?.properties.motion.enum, [
    'nod',
    'shake_head',
    'look_left',
    'look_right',
    'look_up',
    'look_down',
    'center',
  ])
  assert.equal(withLed.play_melody.parameters?.properties.tones.items?.type, 'string')

  const withoutLed = await loadTools(createRobot({ led: false }))
  assert.equal(withoutLed.set_led, undefined)
})

test('emotion and LED tools validate and forward actions', async () => {
  const fixture = createRobot()
  const tools = await loadTools(fixture)

  assert.equal(await tools.set_emotion.execute?.({ emotion: 'happy' }), 'Emotion set to HAPPY')
  assert.deepEqual(fixture.calls.emotions, [3])
  assert.throws(() => tools.set_emotion.execute?.({ emotion: 'surprised' }), /Unknown emotion/)

  await tools.set_led.execute?.({ led: 'head', mode: 'solid', red: 10, green: 20, blue: 30 })
  await tools.set_led.execute?.({ led: 'head', mode: 'blink', red: 1, green: 2, blue: 3, interval_ms: 250 })
  await tools.set_led.execute?.({ led: 'head', mode: 'rainbow' })
  await tools.set_led.execute?.({ led: 'head', mode: 'off' })
  assert.deepEqual(fixture.calls.lights, [
    ['on', 'head', 10, 20, 30],
    ['blink', 'head', 1, 2, 3, 250],
    ['rainbow', 'head'],
    ['off', 'head'],
  ])
  assert.throws(
    () => tools.set_led.execute?.({ led: 'head', mode: 'solid', red: 300, green: 0, blue: 0 }),
    /red must be between/,
  )
})

test('play_motion performs semantic gestures and always releases torque', async () => {
  const fixture = createRobot()
  const startingRotation = { ...fixture.body.rotation }
  const tools = await loadTools(fixture)

  assert.equal(await tools.play_motion.execute?.({ motion: 'nod' }), 'Motion played: nod')
  assert.equal(fixture.calls.lookAway, 1)
  assert.deepEqual(fixture.calls.torque, [true, false])
  assert.equal(fixture.calls.poses.length, 3)
  assert.deepEqual(fixture.calls.poses[2].rotation, startingRotation)

  fixture.robot.motion.setPose = async () => {
    throw new Error('servo failed')
  }
  await assert.rejects(Promise.resolve(tools.play_motion.execute?.({ motion: 'center' })), /servo failed/)
  assert.deepEqual(fixture.calls.torque.slice(-2), [true, false])
})

test('play_melody parses notes and rests inside an input suspension', async () => {
  const fixture = createRobot()
  const suspension: string[] = []
  const rests: number[] = []
  installBareSpecifierPackages()
  const { createRobotChatTools } = (await import('../robot-chat-tools.js')) as RobotChatToolsModule
  const tools = createRobotChatTools(fixture.robot as never, {
    delay: async (milliseconds) => {
      rests.push(milliseconds)
    },
    runWithInputSuspended: async (operation) => {
      suspension.push('suspend')
      try {
        return await operation()
      } finally {
        suspension.push('resume')
      }
    },
  })

  const result = JSON.parse(
    String(
      await tools.play_melody.execute?.({ tones: ['C4:100', 'F#4:180', 'R:120', '440:200', 'invalid'], volume: 0.4 }),
    ),
  )
  assert.deepEqual(fixture.calls.tones, [
    { hz: 262, duration: 100, volume: 0.4 },
    { hz: 370, duration: 180, volume: 0.4 },
    { hz: 440, duration: 200, volume: 0.4 },
  ])
  assert.deepEqual(rests, [120])
  assert.deepEqual(suspension, ['suspend', 'resume'])
  assert.deepEqual(result, { played: 3, rests: 1, skipped: 1, truncated: 0, duration_ms: 600 })
})

test('get_robot_status returns copied pose, LED, and IMU state', async () => {
  const fixture = createRobot({ sample: { accelerometer: { x: 1, y: 2, z: 3 } } })
  const tools = await loadTools(fixture)

  const status = JSON.parse(String(await tools.get_robot_status.execute?.({})))
  assert.deepEqual(status.pose, {
    position: { x: 0.01, y: 0.02, z: 0.03 },
    rotation: { y: 0.1, p: -0.2, r: 0.03 },
  })
  assert.deepEqual(status.leds, ['head'])
  assert.deepEqual(status.imu, { available: true, sample: { accelerometer: { x: 1, y: 2, z: 3 } } })
})
