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
  SINGING_NOTE_OPTIONS,
  singingMoraToKoe,
  singingScoreToKoe,
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

test('singingMoraToKoe converts hiragana, katakana, yoon, moraic n, and long vowels', () => {
  assert.equal(singingMoraToKoe('き'), 'ki')
  assert.equal(singingMoraToKoe('キャ'), 'kya')
  assert.equal(singingMoraToKoe('デャ'), 'dya')
  assert.equal(singingMoraToKoe('ウォ'), 'o')
  assert.equal(singingMoraToKoe('ヰ'), 'i')
  assert.equal(singingMoraToKoe('ん'), 'n')
  assert.equal(singingMoraToKoe('ー', 'ko'), 'o')
  assert.throws(() => singingMoraToKoe('ー'), /前には母音/)
  assert.throws(() => singingMoraToKoe('きら'), /かな1モーラ/)
  assert.throws(() => singingMoraToKoe('っ'), /かな1モーラ/)
})

test('singingScoreToKoe converts tempo and note triples into exact koe notation', () => {
  assert.equal(
    singingScoreToKoe(120, [
      ['C4', 1, 'き'],
      ['C+4', 0.5, 'ラ'],
      ['G4', 2, 'ー'],
      ['R', 0.5, ''],
    ]),
    '#C4,500ki#C+4,250ra#G4,1000a#R,250'
  )
  assert.throws(() => singingScoreToKoe(120, []), /音符または休符/)
  assert.throws(() => singingScoreToKoe(120, [['C4', 1]]), /3項目/)
  assert.throws(() => singingScoreToKoe(120, [['R', 1, 'ら']]), /休符には歌詞/)
  assert.throws(() => singingScoreToKoe(120, [['H4', 1, 'ら']]), /歌唱音符/)
  assert.throws(() => singingScoreToKoe(20, [['C4', 16, 'ら']]), /20〜8000/)
})

test('list-based singing blocks generate one score helper call from note triples', () => {
  const generator = {
    forBlock: {},
    valueToCode: (_block, name) => (name === 'SCORE' ? "[['C4', 1, 'き'], ['R', 0.5, '']]" : ''),
  }
  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, generator, {
    NONE: 99,
    ATOMIC: 0,
    FUNCTION_CALL: 1,
    AWAIT: 2,
  })

  const fieldBlock = (fields) => ({ getFieldValue: (name) => fields[name] })
  assert.equal(
    generator.forBlock.stackchan_sing_score(fieldBlock({ BPM: 120 }), generator),
    "await singScore(robot, 120, [['C4', 1, 'き'], ['R', 0.5, '']])\n"
  )
  assert.deepEqual(generator.forBlock.stackchan_song_note_tuple(fieldBlock({ NOTE: 'C+4', BEATS: 0.5, LYRIC: 'ラ' })), [
    "['C+4', 0.5, 'ラ']",
    0,
  ])
  assert.deepEqual(generator.forBlock.stackchan_song_rest_tuple(fieldBlock({ BEATS: 2 })), ["['R', 2, '']", 0])
})

test('generated singScore helper calls robot.audio.sing and surfaces provider failures', async () => {
  const source = assembleModSource("await singScore(robot, 120, [['C4', 1, 'き'], ['R', 0.5, '']])")
  assert.match(source, /function singingScoreToKoe/)
  let received = ''
  const robot = {
    audio: {
      sing: async (koe) => {
        received = koe
        return { success: true, value: koe }
      },
    },
  }

  await evaluateModule(source).onContextCreated(robot)
  assert.equal(received, '#C4,500ki#R,250')

  const unavailable = { audio: { sing: async () => ({ success: false, reason: 'singing unavailable' }) } }
  await assert.rejects(evaluateModule(source).onContextCreated(unavailable), /singing unavailable/)
})

test('singing blocks compile a typed score into tempo-exact koe notation', () => {
  const generator = { forBlock: {} }
  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, generator, {
    NONE: 0,
    FUNCTION_CALL: 1,
    AWAIT: 2,
  })

  const event = (type, fields, next = null) => ({
    type,
    getFieldValue: (name) => fields[name],
    getNextBlock: () => next,
  })
  const rest = event('stackchan_song_rest', { BEATS: 0.5 })
  const longVowel = event('stackchan_song_note', { NOTE: 'G4', BEATS: 2, LYRIC: 'ー' }, rest)
  const second = event('stackchan_song_note', { NOTE: 'C+4', BEATS: 0.5, LYRIC: 'ラ' }, longVowel)
  const first = event('stackchan_song_note', { NOTE: 'C4', BEATS: 1, LYRIC: 'き' }, second)
  const song = {
    getFieldValue: (name) => (name === 'BPM' ? 120 : undefined),
    getInputTargetBlock: (name) => (name === 'SCORE' ? first : null),
  }

  assert.equal(
    generator.forBlock.stackchan_sing(song),
    "await robot.audio.sing('#C4,500ki#C+4,250ra#G4,1000a#R,250')\n"
  )
  const legacyParent = { type: 'stackchan_sing' }
  assert.equal(generator.forBlock.stackchan_song_note({ getParent: () => legacyParent }), '')
  assert.equal(generator.forBlock.stackchan_song_rest({ getParent: () => legacyParent }), '')
  assert.throws(
    () => generator.forBlock.stackchan_song_note({ getParent: () => null }),
    /旧形式の音符・休符ブロックは直接実行できません/
  )
})

test('singing block generator rejects an empty or out-of-range score', () => {
  const generator = { forBlock: {} }
  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, generator, {
    NONE: 0,
    FUNCTION_CALL: 1,
    AWAIT: 2,
  })
  const emptySong = {
    getFieldValue: () => 120,
    getInputTargetBlock: () => null,
  }
  const longNote = {
    type: 'stackchan_song_note',
    getFieldValue: (name) => ({ NOTE: 'C4', BEATS: 16, LYRIC: 'あ' })[name],
    getNextBlock: () => null,
  }
  const slowSong = {
    getFieldValue: () => 20,
    getInputTargetBlock: () => longNote,
  }

  assert.throws(() => generator.forBlock.stackchan_sing(emptySong), /音符または休符/)
  assert.throws(() => generator.forBlock.stackchan_sing(slowSong), /20〜8000/)
})

test('education blocks do not expose arbitrary JavaScript input', () => {
  let definitions = []
  registerStackchanBlocks(
    {
      defineBlocksWithJsonArray(value) {
        definitions = value
      },
    },
    { forBlock: {} },
    { NONE: 0, FUNCTION_CALL: 1, AWAIT: 2 }
  )

  assert.equal(definitions.length > 0, true)
  assert.deepEqual(
    definitions
      .filter((definition) => /(?:javascript|raw[_-]?js|eval)/i.test(definition.type))
      .map((definition) => definition.type),
    []
  )
  assert.deepEqual(
    definitions.flatMap((definition) =>
      (definition.args0 ?? [])
        .filter(
          (argument) =>
            argument.type === 'field_multilinetext' || /^(?:CODE|SOURCE|JAVASCRIPT|RAW_JS)$/i.test(argument.name ?? '')
        )
        .map((argument) => `${definition.type}:${argument.name ?? argument.type}`)
    ),
    []
  )
})

test('head touch block exposes head sensor gestures and generates a petting handler', () => {
  let definitions = []
  const generator = { forBlock: {}, statementToCode: () => '' }
  registerStackchanBlocks(
    {
      defineBlocksWithJsonArray(value) {
        definitions = value
      },
    },
    generator,
    { NONE: 0, FUNCTION_CALL: 1, AWAIT: 2 }
  )

  const definition = definitions.find(({ type }) => type === 'stackchan_on_head_touch')
  assert.equal(definition.message0, '頭部タッチセンサが %1 とき %2 %3')
  assert.equal(definition.tooltip, '頭上の静電容量式タッチセンサを操作したときに実行します')
  assert.deepEqual(definition.args0[0].options, [
    ['タッチされた', 'press'],
    ['はなされた', 'release'],
    ['前方へスワイプされた', 'forwardSwipe'],
    ['後方へスワイプされた', 'backwardSwipe'],
    ['なでられた', 'petting'],
  ])

  const code = generator.forBlock.stackchan_on_head_touch(
    { id: 'head-touch-id', getFieldValue: () => 'petting' },
    generator
  )
  assert.match(code, /^runtime\.add\(onHeadTouch\(robot, 'petting',/)
  assert.match(code, /reportVisualError\('VP_RUNTIME_HANDLER', 'head-touch-id', error, 'head touch'\)/)
})

test('generator reserves every identifier injected into the visual runtime scope', () => {
  let reservedWords = ''
  const generator = {
    forBlock: {},
    addReservedWords(words) {
      reservedWords = words
    },
  }

  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, generator, { NONE: 0, FUNCTION_CALL: 1, AWAIT: 2 })

  assert.equal(generator.INFINITE_LOOP_TRAP, 'visualLoopGuard(%1);\n')
  const reserved = new Set(reservedWords.split(','))
  for (const name of [
    'runtime',
    'visualLoopGuard',
    'createVisualRuntime',
    'createVisualLoopGuard',
    'reportVisualError',
    'onButton',
    'onImu',
    'onHeadTouch',
    'event',
  ]) {
    assert.equal(reserved.has(name), true, `${name} must be reserved`)
  }
})

test('assembleModSource wraps the body in onContextCreated', () => {
  const source = assembleModSource('robot.face.setEmotion(Emotion.HAPPY)\n')
  assert.match(source, /export async function onContextCreated\(robot\) \{/)
  assert.match(source, /^  robot\.face\.setEmotion\(Emotion\.HAPPY\)$/m)
  assert.match(source, /import \{ Emotion \} from 'face-state'/)
  assert.match(source, /function createVisualLoopGuard\(\)/)
  assert.match(source, /return function visualLoopGuard\(blockId\)/)
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
  const timerSource = assembleModSource('runtime.addTimer(Timer.repeat(() => {}, 1000))\n').replace(
    "import Timer from 'timer'",
    ''
  )
  const { onContextCreated } = evaluateModule(timerSource, { Timer })
  const robot = {}
  await onContextCreated(robot)
  assert.equal(active.size, 1)
  await onContextCreated(robot)
  assert.deepEqual([...active], [2], 'reload must clear the first timer')
  robot.__visualProgram.dispose()
  assert.equal(active.size, 0)

  const loopSource = assembleModSource('for (let index = 0; index < 10001; index += 1) visualLoopGuard()\n')
  await assert.rejects(evaluateModule(loopSource).onContextCreated({}), /ループの実行上限/)
})

test('overlapping event handlers keep independent loop budgets', async () => {
  let releaseFirst
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const generator = {
    forBlock: {},
    statementToCode: (block) =>
      block.id === 'first-event'
        ? "for (let index = 0; index < 9999; index += 1) visualLoopGuard('first-loop')\nawait robot.firstGate\nvisualLoopGuard('first-loop')\n"
        : '',
  }
  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, generator, { NONE: 0, FUNCTION_CALL: 1, AWAIT: 2 })
  const eventBlock = (id, button) => ({
    id,
    getFieldValue(name) {
      return name === 'BUTTON' ? button : 'press'
    },
  })
  const source = assembleModSource(
    generator.forBlock.stackchan_on_button(eventBlock('first-event', 'a'), generator) +
      generator.forBlock.stackchan_on_button(eventBlock('second-event', 'b'), generator)
  )
  const traces = []
  const robot = { firstGate, input: { button: { a: {}, b: {} } } }
  await evaluateModule(source, { trace: (line) => traces.push(line) }).onContextCreated(robot)

  robot.input.button.a.onEvent({ pressed: true })
  robot.input.button.b.onEvent({ pressed: true })
  releaseFirst()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(traces.length, 1)
  assert.equal(JSON.parse(traces[0].replace(/^#stackchan /, '')).block_id, 'first-loop')
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

test('procedures inherit a fresh loop budget from each event invocation', async () => {
  const generator = {
    forBlock: {},
    definitions_: {},
    INDENT: '  ',
    addReservedWords() {},
    getProcedureName: (name) => name,
    getVariableName: (name) => name,
    injectId: (template, block) => template.replace('%1', `'${block.id}'`),
    prefixLines: (text, prefix) => text.replace(/^(?!$)/gm, prefix),
    statementToCode: (block) => {
      if (block.id === 'procedure-definition') {
        return "  for (let index = 0; index < 9998; index += 1) visualLoopGuard('procedure-loop')\n"
      }
      return generator.forBlock.procedures_callnoreturn(
        {
          getFieldValue: () => 'guardedProcedure',
          getVars: () => [],
        },
        generator
      )
    },
    valueToCode: () => '',
    scrub_: (_block, code) => code,
  }
  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, generator, { NONE: 0, FUNCTION_CALL: 1, AWAIT: 2 })

  const definition = {
    id: 'procedure-definition',
    getFieldValue: () => 'guardedProcedure',
    getInput: (name) => name === 'STACK',
    getVars: () => [],
  }
  generator.forBlock.procedures_defnoreturn(definition, generator)
  assert.match(generator.definitions_['%guardedProcedure'], /^async function guardedProcedure\(visualLoopGuard\)/)

  const eventBlock = {
    id: 'event-id',
    getFieldValue(name) {
      return name === 'BUTTON' ? 'a' : 'press'
    },
  }
  const body =
    `${generator.definitions_['%guardedProcedure']}\n` + generator.forBlock.stackchan_on_button(eventBlock, generator)
  const source = assembleModSource(body)
  const traces = []
  const robot = { input: { button: { a: {} } } }
  await evaluateModule(source, { trace: (line) => traces.push(line) }).onContextCreated(robot)

  robot.input.button.a.onEvent({ pressed: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  robot.input.button.a.onEvent({ pressed: true })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(traces, [])
})

test('assembleModSource injects event dispatch helpers only when used', () => {
  const withButton = assembleModSource("onButton(robot, 'a', 'press', (event) => {})\n")
  assert.match(withButton, /function onButton\(robot, name, edge, handler\)/)
  assert.doesNotMatch(withButton, /function onImu/)
  assert.doesNotMatch(withButton, /function onHeadTouch/)

  const withImu = assembleModSource("onImu(robot, 'shake', (event) => {})\n")
  assert.match(withImu, /function onImu\(robot, motion, handler\)/)
  assert.match(withImu, /imu\.start\?\.\(\)/) // IMU must be started

  const withHeadTouch = assembleModSource("onHeadTouch(robot, 'forwardSwipe', (event) => {})\n")
  assert.match(withHeadTouch, /function onHeadTouch\(robot, gesture, handler\)/)

  const plain = assembleModSource('robot.ui.showFace()\n')
  assert.doesNotMatch(plain, /function onButton|function onImu|function onHeadTouch/)
})

test('event dispatch helpers preserve duplicate handlers and remove only their own callback', async () => {
  const source = assembleModSource(`
robot.removeFirstButton = onButton(robot, 'a', 'press', () => { robot.firstButton += 1 })
robot.removeSecondButton = onButton(robot, 'a', 'press', () => { robot.secondButton += 1 })
robot.removeFirstImu = onImu(robot, 'shake', () => { robot.firstImu += 1 })
robot.removeSecondImu = onImu(robot, 'shake', () => { robot.secondImu += 1 })
robot.removeFirstHeadTouch = onHeadTouch(robot, 'press', () => { robot.firstHeadTouch += 1 })
robot.removeSecondHeadTouch = onHeadTouch(robot, 'press', () => { robot.secondHeadTouch += 1 })
`)
  const previousCalls = []
  const previousButton = () => previousCalls.push('button')
  const previousImu = () => previousCalls.push('imu')
  const previousHeadTouch = () => previousCalls.push('headTouch')
  const robot = {
    firstButton: 0,
    secondButton: 0,
    firstImu: 0,
    secondImu: 0,
    firstHeadTouch: 0,
    secondHeadTouch: 0,
    input: {
      button: { a: { onEvent: previousButton } },
      imu: { onEvent: previousImu },
      touchPanel: { onEvent: previousHeadTouch },
    },
  }
  await evaluateModule(source).onContextCreated(robot)

  robot.input.button.a.onEvent({ pressed: true })
  robot.input.imu.onEvent({ motion: 'shake' })
  robot.input.touchPanel.onEvent({ gesture: 'press', ticks: 100 })
  assert.deepEqual(
    [
      robot.firstButton,
      robot.secondButton,
      robot.firstImu,
      robot.secondImu,
      robot.firstHeadTouch,
      robot.secondHeadTouch,
    ],
    [1, 1, 1, 1, 1, 1]
  )
  assert.deepEqual(previousCalls, ['button', 'imu', 'headTouch'])

  robot.removeFirstButton()
  robot.removeFirstImu()
  robot.removeFirstHeadTouch()
  robot.input.button.a.onEvent({ pressed: true })
  robot.input.imu.onEvent({ motion: 'shake' })
  robot.input.touchPanel.onEvent({ gesture: 'press', ticks: 200 })
  assert.deepEqual(
    [
      robot.firstButton,
      robot.secondButton,
      robot.firstImu,
      robot.secondImu,
      robot.firstHeadTouch,
      robot.secondHeadTouch,
    ],
    [1, 2, 1, 2, 1, 2]
  )

  robot.removeSecondButton()
  robot.removeSecondImu()
  robot.removeSecondHeadTouch()
  assert.equal(robot.input.button.a.onEvent, previousButton)
  assert.equal(robot.input.imu.onEvent, previousImu)
  assert.equal(robot.input.touchPanel.onEvent, previousHeadTouch)
})

test('head touch helper recognizes petting in both directions within 1.5 seconds', async () => {
  const source = assembleModSource(
    "runtime.add(onHeadTouch(robot, 'petting', (event) => { robot.pettingEvents.push(event) }))\n"
  )
  const previousEvents = []
  const previous = (event) => previousEvents.push(event)
  const touchPanel = { onEvent: previous }
  const robot = { pettingEvents: [], input: { touchPanel } }
  await evaluateModule(source).onContextCreated(robot)

  const emit = (gesture, ticks) => touchPanel.onEvent({ gesture, position: 0, intensity: 3, ticks })
  emit('forwardSwipe', 100)
  emit('backwardSwipe', 1600)
  emit('forwardSwipe', 3600)
  emit('backwardSwipe', 3700)
  emit('backwardSwipe', 5600)
  emit('forwardSwipe', 5700)
  emit('forwardSwipe', 7600)
  emit('forwardSwipe', 7700)
  emit('backwardSwipe', 9600)
  emit('forwardSwipe', 11200)

  assert.deepEqual(
    robot.pettingEvents.map(({ gesture, ticks }) => [gesture, ticks]),
    [
      ['petting', 1600],
      ['petting', 3700],
      ['petting', 5700],
    ]
  )
  assert.deepEqual(
    previousEvents.map(({ gesture, ticks }) => [gesture, ticks]),
    [
      ['forwardSwipe', 100],
      ['backwardSwipe', 1600],
      ['forwardSwipe', 3600],
      ['backwardSwipe', 3700],
      ['backwardSwipe', 5600],
      ['forwardSwipe', 5700],
      ['forwardSwipe', 7600],
      ['forwardSwipe', 7700],
      ['backwardSwipe', 9600],
      ['forwardSwipe', 11200],
    ]
  )

  robot.__visualProgram.dispose()
  assert.equal(touchPanel.onEvent, previous)
  assert.equal(touchPanel.__visualLastForwardSwipeTicks, undefined)
  assert.equal(touchPanel.__visualLastBackwardSwipeTicks, undefined)
})

test('assembleModSource emits valid JavaScript for the new event blocks', () => {
  // representative generator output for on_button / on_imu / on_head_touch /
  // on_drawer_button / set_pose / light_blink / drawer_control
  const body =
    "onButton(robot, 'a', 'release', (event) => {\n  void (async () => {\n    robot.face.setEmotion(Emotion.HAPPY)\n  })().catch((error) => trace('button a handler failed: ' + error + '\\n'))\n})\n" +
    "onImu(robot, 'shake', (event) => {\n  void (async () => {\n    await robot.audio.say(String('わっ'))\n  })().catch((error) => trace('imu handler failed: ' + error + '\\n'))\n})\n" +
    "onHeadTouch(robot, 'petting', (event) => {\n  void (async () => {\n    robot.ui.toggleDrawer()\n  })().catch((error) => trace('head touch handler failed: ' + error + '\\n'))\n})\n" +
    "robot.ui.drawer?.addDrawerButton({ key: 'k', label: 'ボタン', callback: () => {\n  void (async () => {\n    robot.ui.showFace()\n  })().catch((error) => trace('drawer handler failed: ' + error + '\\n'))\n} })\n" +
    'await robot.motion.setPose({ rotation: { p: (30 * Math.PI) / 180, y: (-45 * Math.PI) / 180, r: 0 } }, 0.5)\n' +
    "robot.lighting.lightBlink('a', ...hexToRgb('#ff4040'), 250)\n"
  const source = assembleModSource(body)
  assert.match(source, /function onButton/)
  assert.match(source, /function onImu/)
  assert.match(source, /function onHeadTouch/)
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
  for (const [label, value] of SINGING_NOTE_OPTIONS) {
    assert.ok(label.length > 0)
    assert.match(value, /^[A-G](?:[+-])?[0-8]$/)
  }
})

test('toolbox categories do not repeat an identical block entry', () => {
  for (const category of TOOLBOX.contents) {
    if (!Array.isArray(category.contents)) continue
    const entries = category.contents.filter((entry) => entry.kind === 'block').map((entry) => JSON.stringify(entry))
    assert.equal(new Set(entries).size, entries.length, `${category.name} contains a duplicate block entry`)
  }
})

test('singing toolbox starts with a list of note triples and hides legacy statement-score blocks', () => {
  const speech = TOOLBOX.contents.find((category) => category.name === 'おしゃべり')
  const types = speech.contents.filter((entry) => entry.kind === 'block').map((entry) => entry.type)
  assert.ok(types.includes('stackchan_sing_score'))
  assert.ok(types.includes('stackchan_song_note_tuple'))
  assert.ok(types.includes('stackchan_song_rest_tuple'))
  assert.equal(types.includes('stackchan_sing'), false)
  assert.equal(types.includes('stackchan_song_note'), false)
  assert.equal(types.includes('stackchan_song_rest'), false)

  const sing = speech.contents.find((entry) => entry.type === 'stackchan_sing_score')
  assert.equal(sing.inputs.SCORE.block.type, 'lists_create_with')
  assert.equal(sing.inputs.SCORE.block.extraState.itemCount, 4)
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
  assert.match(generator.definitions_['%greet'], /^async function greet\(visualLoopGuard, count\)/)
  assert.match(generator.definitions_['%greet'], /await robot\.audio\.say/)

  const call = {
    getFieldValue: () => 'greet',
    getVars: () => ['count'],
  }
  assert.deepEqual(generator.forBlock.procedures_callreturn(call, generator), ['await greet(visualLoopGuard, 42)', 4])
  assert.equal(generator.forBlock.procedures_callnoreturn(call, generator), 'await greet(visualLoopGuard, 42);\n')
})
