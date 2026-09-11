import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import Blockly from 'blockly/core'
import 'blockly/blocks'
import * as en from 'blockly/msg/en'
Blockly.setLocale(en)
import { javascriptGenerator, Order } from 'blockly/javascript'
import { defineApp } from 'stackchan'
import { input } from 'stackchan/extensions/input'
import { ui } from 'stackchan/extensions/ui'
import { lighting } from 'stackchan/extensions/lighting'
import { singing } from 'stackchan/extensions/audio'
import {
  assembleModSource,
  registerStackchanBlocks,
  escapeSingleQuoted,
  EMOTION_OPTIONS,
  COLOR_OPTIONS,
  NOTE_OPTIONS,
  SINGING_NOTE_OPTIONS,
  TOOLBOX,
} from './blocks.mjs'
import { VISUAL_SAMPLES } from './samples.mjs'
import { applyFaceAssetToSource, createFaceAsset } from './face-assets.mjs'

function evaluate(source, trace = () => {}) {
  const body = source.replace(/^import .*$/gm, '').replace('export default ', 'return ')
  return new Function('defineApp', 'input', 'ui', 'lighting', 'singing', 'trace', body)(
    defineApp,
    input,
    ui,
    lighting,
    singing,
    trace
  )
}
function generator() {
  const gen = {
    forBlock: {},
    statementToCode: (block) => block.body ?? '',
    valueToCode: (block, key) => block.values?.[key] ?? '',
  }
  registerStackchanBlocks({ defineBlocksWithJsonArray() {} }, gen, Order)
  return gen
}
const block = (fields = {}, body = '', id = 'example', values = {}) => ({
  id,
  body,
  values,
  getFieldValue: (key) => fields[key],
})
function fixture() {
  const events = new Map(),
    after = [],
    calls = []
  const signal = {
    reason: undefined,
    throwIfCancelled() {
      if (this.reason) throw this.reason
    },
    subscribe: () => () => {},
  }
  const task = {
    signal,
    async sleep(ms) {
      signal.throwIfCancelled()
      calls.push(['sleep', ms])
    },
  }
  const record =
    (name) =>
    (...args) => {
      calls.push([name, ...args])
    }
  const register = (name) => (key, handler) => {
    events.set(`${name}:${key}`, handler)
    return () => events.delete(`${name}:${key}`)
  }
  const app = {
    face: { setEmotion: record('emotion'), setColor: record('color'), setMouthOpen: record('mouth') },
    audio: { say: record('say'), tone: record('tone'), sing: record('sing') },
    input: {
      onPress: register('press'),
      onRelease: register('release'),
      onMotion: (handler) => {
        events.set('motion', handler)
      },
      onHeadTouch: (handler, options) => {
        events.set(`head:${options.gesture}`, handler)
      },
    },
    motion: {
      move: record('move'),
      lookAt: record('gaze'),
      lookAway: record('away'),
      hold: record('hold'),
      relax: record('relax'),
    },
    ui: {
      addAction: (options, handler) => events.set(options.id, handler),
      setShapeFace: record('shape'),
      showBalloon: record('balloon'),
      hideBalloon: record('hide'),
      openMenu: record('open'),
      closeMenu: record('close'),
      toggleMenu: record('toggle'),
      showFace: record('face'),
    },
    lighting: {
      names: ['head'],
      color: record('light'),
      blink: record('blink'),
      off: record('off'),
      rainbow: record('rainbow'),
    },
    time: {
      after: (ms, handler) => {
        after.push(handler)
        return () => {}
      },
      every: register('every'),
    },
  }
  return {
    app,
    events,
    task,
    calls,
    after,
    async start(source, trace) {
      evaluate(source, trace).setup(app)
      while (after.length) await after.shift()(task)
    },
  }
}

test('generated operations retain SDK units, colors, song data and cancellation', async () => {
  const gen = generator(),
    f = fixture()
  const source = assembleModSource(
    [
      gen.forBlock.stackchan_set_color(block({ KEY: 'primary', COLOR: '#30e0ff' })),
      gen.forBlock.stackchan_set_emotion(block({ EMOTION: 'DOUBTFUL' })),
      gen.forBlock.stackchan_set_pose(block({ PITCH: -20, YAW: 30, TIME: 0.5 })),
      gen.forBlock.stackchan_tone(block({ NOTE: 440, DURATION: 250 })),
      gen.forBlock.stackchan_look_at(block({ X: 1, Y: 1, Z: 0 })),
      gen.forBlock.stackchan_light_blink(block({ NAME: 'head', COLOR: '#ff0000', INTERVAL: 250 })),
      gen.forBlock.stackchan_sing_score(
        block({ BPM: 120 }, '', 'song', { SCORE: "[['C4', 1, 'き'], ['R', 0.5, '']]" }),
        gen
      ),
    ].join('')
  )
  await f.start(source)
  assert.deepEqual(f.calls, [
    ['color', 'primary', { r: 48, g: 224, b: 255 }],
    ['emotion', 'doubt'],
    ['move', { pitchDeg: -20, yawDeg: 30 }, { durationMs: 500, signal: f.task.signal }],
    ['tone', 440, { durationMs: 250, signal: f.task.signal }],
    ['gaze', { yawDeg: 45, pitchDeg: 0 }],
    ['blink', 'head', { r: 255, g: 0, b: 0 }, { periodMs: 250 }],
    [
      'sing',
      120,
      [
        ['C4', 1, 'き'],
        ['R', 0.5, ''],
      ],
      { signal: f.task.signal },
    ],
  ])
})

test('events register with the SDK and return their pending work to its owner', async () => {
  const gen = generator(),
    f = fixture(),
    logs = []
  let finish
  f.app.audio.say = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const body = "await app.audio.say('hello', { signal: task.signal })\nawait task.sleep(20)"
  await f.start(
    assembleModSource(
      [
        gen.forBlock.stackchan_on_button(block({ BUTTON: 'a', EDGE: 'press' }, body), gen),
        gen.forBlock.stackchan_on_button(block({ BUTTON: 'b', EDGE: 'release' }, body), gen),
        gen.forBlock.stackchan_on_head_touch(block({ GESTURE: 'petting' }, body), gen),
        gen.forBlock.stackchan_every(block({ SECONDS: 1 }, body), gen),
        gen.forBlock.stackchan_on_drawer_button(block({ LABEL: 'menu' }, body, 'menu'), gen),
      ].join('')
    ),
    (line) => logs.push(line)
  )
  assert.deepEqual([...f.events.keys()], ['press:primary', 'release:secondary', 'head:petting', 'every:1000', 'menu'])
  const pending = f.events.get('press:primary')(f.task)
  assert.ok(pending instanceof Promise)
  let settled = false
  pending.then(() => {
    settled = true
  })
  await Promise.resolve()
  assert.equal(settled, false)
  f.task.signal.reason = new Error('app closed')
  finish()
  await pending
  assert.deepEqual(f.calls, [], 'cancelled handler cannot continue through its next wait')
  assert.deepEqual(logs, [], 'normal cancellation is not an error report')
})

test('each invocation has its own loop budget and reports the failing block', async () => {
  const gen = generator(),
    f = fixture(),
    logs = []
  const body = "for (let n = 0; n < 10000; n++) visualLoopGuard('loop-id')"
  await f.start(assembleModSource(gen.forBlock.stackchan_on_button(block({ BUTTON: 'a' }, body), gen)), (line) =>
    logs.push(JSON.parse(line.slice('#stackchan '.length)))
  )
  await f.events.get('press:primary')(f.task)
  await f.events.get('press:primary')(f.task)
  assert.equal(logs.length, 2)
  for (const error of logs) assert.equal(error.block_id, 'loop-id')
})

test('field literals round trip quotes, slashes and line breaks', () => {
  for (const raw of ['head', "a'b", 'a\\b', 'a\nb', '\r', '\u2028']) {
    assert.equal(new Function(`return '${escapeSingleQuoted(raw)}'`)(), raw)
  }
})

test('all sample programs and face assets compile strictly against the public SDK', () => {
  registerStackchanBlocks(Blockly, javascriptGenerator, Order)
  const directory = mkdtempSync(resolve(tmpdir(), 'stackchan-generated-sdk-'))
  try {
    for (const sample of VISUAL_SAMPLES) {
      const workspace = new Blockly.Workspace()
      try {
        Blockly.serialization.workspaces.load(sample.workspace, workspace)
        const source = assembleModSource(javascriptGenerator.workspaceToCode(workspace))
        writeFileSync(resolve(directory, `${sample.id}.js`), source)
        writeFileSync(resolve(directory, `${sample.id}-face.js`), applyFaceAssetToSource(source, createFaceAsset()))
      } finally {
        workspace.dispose()
      }
    }
    writeFileSync(resolve(directory, 'globals.d.ts'), 'declare function trace(message: string): void;')
    writeFileSync(
      resolve(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          allowJs: true,
          checkJs: true,
          noEmit: true,
          target: 'ES2025',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          types: [],
          lib: ['ES2025'],
          paths: { stackchan: [resolve('../firmware/sdk/index.ts')], 'stackchan/*': [resolve('../firmware/sdk/*.ts')] },
        },
        include: ['*.js', '*.d.ts'],
      })
    )
    try {
      execFileSync(resolve('../firmware/node_modules/.bin/tsc'), ['--project', resolve(directory, 'tsconfig.json')], {
        encoding: 'utf8',
      })
    } catch (error) {
      assert.fail(error.stdout || error.message)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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
