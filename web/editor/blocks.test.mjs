import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assembleModSource,
  COLOR_OPTIONS,
  EMOTION_OPTIONS,
  escapeSingleQuoted,
  NOTE_OPTIONS,
  registerStackchanBlocks,
  registerAsyncProcedureGenerators,
  TOOLBOX,
} from './blocks.mjs'

function evaluateModule(source, parameters = {}) {
  const names = Object.keys(parameters)
  const values = Object.values(parameters)
  const executable = source.replace(/^import .*$/gm, '').replace('export async function', 'async function')
  return new Function(...names, `${executable}\nreturn { onContextCreated }`)(...values)
}

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
  assert.match(source, /function visualLoopGuard\(blockId\)/)
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

test('generated runtime disposes old input handlers before reloading on the same robot', async () => {
  const source = assembleModSource(
    "runtime.add(onButton(robot, 'a', 'press', () => { robot.pressCount = (robot.pressCount ?? 0) + 1 }))\n"
  )
  const { onContextCreated } = evaluateModule(source)
  const original = () => {}
  const robot = { input: { button: { a: { onEvent: original } } } }

  await onContextCreated(robot)
  const firstDispatcher = robot.input.button.a.onEvent
  firstDispatcher({ pressed: true })
  assert.equal(robot.pressCount, 1)

  await onContextCreated(robot)
  const secondDispatcher = robot.input.button.a.onEvent
  assert.notEqual(secondDispatcher, firstDispatcher)
  secondDispatcher({ pressed: true })
  assert.equal(robot.pressCount, 2, 'only the reloaded handler must run')

  robot.__visualProgram.dispose()
  assert.equal(robot.input.button.a.onEvent, original)
  assert.equal(robot.input.button.a.__visualWired, false)
})

test('generated runtime clears timers on reload and enforces the loop budget', async () => {
  const active = new Set()
  let nextTimer = 0
  const Timer = {
    repeat() {
      const token = ++nextTimer
      active.add(token)
      return token
    },
    clear(token) {
      active.delete(token)
    },
  }
  const timerSource = assembleModSource(
    'const visualTimer = Timer.repeat(() => {}, 1000)\nruntime.add(() => Timer.clear(visualTimer))\n'
  ).replace("import Timer from 'timer'", '')
  const { onContextCreated } = evaluateModule(timerSource, { Timer })
  const robot = {}
  await onContextCreated(robot)
  assert.equal(active.size, 1)
  await onContextCreated(robot)
  assert.deepEqual([...active], [2], 'reload must clear the first timer')
  robot.__visualProgram.dispose()
  assert.equal(active.size, 0)

  const loopSource = assembleModSource(
    'resetVisualLoopBudget()\nfor (let index = 0; index < 10001; index += 1) visualLoopGuard()\n'
  )
  await assert.rejects(evaluateModule(loopSource).onContextCreated({}), /ループの実行上限/)
})

test('an event handler reports the exact loop block that exhausted its budget', async () => {
  const generator = {
    forBlock: {},
    statementToCode: () => "for (let index = 0; index < 10001; index += 1) visualLoopGuard('loop-id')\n",
  }
  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, generator, { NONE: 0, FUNCTION_CALL: 1, AWAIT: 2 })
  const eventBlock = {
    id: 'event-id',
    getFieldValue(name) {
      return name === 'BUTTON' ? 'a' : 'press'
    },
  }
  const source = assembleModSource(generator.forBlock.stackchan_on_button(eventBlock, generator))
  const traces = []
  const robot = { input: { button: { a: {} } } }
  await evaluateModule(source, { trace: (line) => traces.push(line) }).onContextCreated(robot)

  robot.input.button.a.onEvent({ pressed: true })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(traces.length, 1)
  const diagnostic = JSON.parse(traces[0].replace(/^#stackchan /, ''))
  assert.equal(diagnostic.error_code, 'VP_RUNTIME_HANDLER')
  assert.equal(diagnostic.block_id, 'loop-id')
  assert.match(diagnostic.message, /^button a: Error: ループの実行上限/)
})

test('assembleModSource injects event dispatch helpers only when used', () => {
  const withButton = assembleModSource("onButton(robot, 'a', 'press', (event) => {})\n")
  assert.match(withButton, /function onButton\(robot, name, edge, handler\)/)
  assert.doesNotMatch(withButton, /function onImu/)
  assert.doesNotMatch(withButton, /function onTouchPanel/)

  const withImu = assembleModSource("onImu(robot, 'shake', (event) => {})\n")
  assert.match(withImu, /function onImu\(robot, motion, handler\)/)
  assert.match(withImu, /imu\.start\?\.\(\)/) // IMU must be started

  const withTouch = assembleModSource("onTouchPanel(robot, 'forwardSwipe', (event) => {})\n")
  assert.match(withTouch, /function onTouchPanel\(robot, gesture, handler\)/)

  const plain = assembleModSource('robot.ui.showFace()\n')
  assert.doesNotMatch(plain, /function onButton|function onImu|function onTouchPanel/)
})

test('assembleModSource emits valid JavaScript for the new event blocks', () => {
  // representative generator output for on_button / on_imu / on_touch /
  // on_drawer_button / set_pose / light_blink / drawer_control
  const body =
    "onButton(robot, 'a', 'release', (event) => {\n  void (async () => {\n    robot.face.setEmotion(Emotion.HAPPY)\n  })().catch((error) => trace('button a handler failed: ' + error + '\\n'))\n})\n" +
    "onImu(robot, 'shake', (event) => {\n  void (async () => {\n    await robot.audio.say(String('わっ'))\n  })().catch((error) => trace('imu handler failed: ' + error + '\\n'))\n})\n" +
    "onTouchPanel(robot, 'forwardSwipe', (event) => {\n  void (async () => {\n    robot.ui.toggleDrawer()\n  })().catch((error) => trace('touch handler failed: ' + error + '\\n'))\n})\n" +
    "robot.ui.drawer?.addDrawerButton({ key: 'k', label: 'ボタン', callback: () => {\n  void (async () => {\n    robot.ui.showFace()\n  })().catch((error) => trace('drawer handler failed: ' + error + '\\n'))\n} })\n" +
    'await robot.motion.setPose({ rotation: { p: (30 * Math.PI) / 180, y: (-45 * Math.PI) / 180, r: 0 } }, 0.5)\n' +
    "robot.lighting.lightBlink('a', ...hexToRgb('#ff4040'), 250)\n"
  const source = assembleModSource(body)
  assert.match(source, /function onButton/)
  assert.match(source, /function onImu/)
  assert.match(source, /function onTouchPanel/)
  assert.match(source, /function hexToRgb/)
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
  for (const [label, value] of NOTE_OPTIONS) {
    assert.ok(label.length > 0)
    const hz = Number(value)
    assert.ok(Number.isInteger(hz) && hz >= 20 && hz <= 20000, `note ${label} has a valid frequency`)
  }
})

test('toolbox categories do not repeat an identical block entry', () => {
  for (const category of TOOLBOX.contents) {
    if (!Array.isArray(category.contents)) continue
    const entries = category.contents.filter((entry) => entry.kind === 'block').map((entry) => JSON.stringify(entry))
    assert.equal(new Set(entries).size, entries.length, `${category.name} contains a duplicate block entry`)
  }
})

test('procedure generators are async so speech and wait blocks remain valid inside functions', () => {
  const generator = {
    forBlock: {},
    definitions_: {},
    INDENT: '  ',
    INFINITE_LOOP_TRAP: '',
    getProcedureName: (name) => name,
    getVariableName: (name) => name,
    statementToCode: () => "  await robot.audio.say('やあ')\n",
    valueToCode: () => '42',
    scrub_: (_block, code) => code,
  }
  registerAsyncProcedureGenerators(generator, { NONE: 99, AWAIT: 4, FUNCTION_CALL: 2 })
  const definition = {
    getFieldValue: () => 'greet',
    getInput: (name) => name === 'STACK' || name === 'RETURN',
    getVars: () => ['count'],
  }
  generator.forBlock.procedures_defreturn(definition, generator)
  assert.match(generator.definitions_['%greet'], /^async function greet\(count\)/)
  assert.match(generator.definitions_['%greet'], /await robot\.audio\.say/)

  const call = {
    getFieldValue: () => 'greet',
    getVars: () => ['count'],
  }
  assert.deepEqual(generator.forBlock.procedures_callreturn(call, generator), ['await greet(42)', 4])
  assert.equal(generator.forBlock.procedures_callnoreturn(call, generator), 'await greet(42);\n')
})
