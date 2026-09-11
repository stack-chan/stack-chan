/**
 * Stack-chan Blockly blocks and JavaScript code generation.
 *
 * The generated program is a Stack-chan MOD module: the workspace code becomes
 * the setup of `defineApp`. Events and operations belong to the SDK AppSession.
 */

import { t } from '../i18n.mjs'

export const VISUAL_RUNTIME_RESERVED_WORDS = Object.freeze([
  'app',
  'task',
  'defineApp',
  'input',
  'ui',
  'lighting',
  'singing',
  'randomBetween',
  'hexToRgb',
  'trace',
  'createVisualLoopGuard',
  'visualLoopGuard',
  'reportVisualError',
  'event',
  '_StackchanVisualShapeFace',
])

const HELPER_HEX_TO_RGB = `/** @param {string} hex */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}`

const HELPER_LOOP_GUARD = `function createVisualLoopGuard() {
  let remaining = 10000
  /** @param {string} blockId */
  return function visualLoopGuard(blockId) {
    if (--remaining <= 0) {
      throw Object.assign(new Error('ループの実行上限を超えました'), { visualBlockId: blockId })
    }
  }
}

/** @param {string} errorCode @param {string} blockId @param {unknown} error @param {string} [context] */
function reportVisualError(errorCode, blockId, error, context = '') {
  trace('#stackchan ' + JSON.stringify({
    schema_version: 1,
    component: 'visual-programming',
    event: 'error',
    error_code: errorCode,
    block_id: error && typeof error === 'object' && 'visualBlockId' in error ? error.visualBlockId : blockId,
    message: (context ? context + ': ' : '') + String(error),
  }) + '\\n')
}`

/** Generate one SDK app. AppSession owns handlers, subscriptions and pending operations. */
export function assembleModSource(body) {
  const imports = ["import { defineApp } from 'stackchan'"]
  for (const name of ['input', 'ui', 'lighting']) {
    if (new RegExp(`\\b${name}\\(app\\)`).test(body))
      imports.push(`import { ${name} } from 'stackchan/extensions/${name}'`)
  }
  if (/\bsinging\(app\)/.test(body)) imports.push("import { singing } from 'stackchan/extensions/audio'")
  const helpers = [HELPER_LOOP_GUARD]
  if (/\bhexToRgb\s*\(/.test(body)) helpers.push(HELPER_HEX_TO_RGB)
  if (/\brandomBetween\s*\(/.test(body))
    helpers.push(`/** @param {number} min @param {number} max */
function randomBetween(min, max) { return min + Math.random() * (max - min) }`)
  const indented = body
    .split('\n')
    .map((line) => (line ? '      ' + line : ''))
    .join('\n')
    .trimEnd()
  return `${imports.join('\n')}\n\n${helpers.join('\n\n')}\n\nexport default defineApp({
  setup(app) {
    app.time.after(0, async (task) => {
      const visualLoopGuard = createVisualLoopGuard()
${indented}
    })
  },
})\n`
}

export const EMOTION_OPTIONS = [
  ['ふつう', 'NEUTRAL'],
  ['うれしい', 'HAPPY'],
  ['おこった', 'ANGRY'],
  ['かなしい', 'SAD'],
  ['ねむい', 'SLEEPY'],
  ['こまった', 'DOUBTFUL'],
  ['さむい', 'COLD'],
  ['あつい', 'HOT'],
]

export const COLOR_OPTIONS = [
  ['白', '#ffffff'],
  ['黒', '#202020'],
  ['赤', '#ff4040'],
  ['オレンジ', '#ff9900'],
  ['黄', '#ffe040'],
  ['緑', '#40c040'],
  ['水色', '#30e0ff'],
  ['青', '#3060ff'],
  ['紫', '#9040ff'],
  ['ピンク', '#ff70d8'],
]

// Musical notes (C major, 2 octaves + top C) as dropdown label -> frequency Hz.
// app.audio.tone() takes Hz, so the value is the frequency directly.
export const NOTE_OPTIONS = [
  ['ド4', '262'],
  ['レ4', '294'],
  ['ミ4', '330'],
  ['ファ4', '349'],
  ['ソ4', '392'],
  ['ラ4', '440'],
  ['シ4', '494'],
  ['ド5', '523'],
  ['レ5', '587'],
  ['ミ5', '659'],
  ['ファ5', '698'],
  ['ソ5', '784'],
  ['ラ5', '880'],
  ['シ5', '988'],
  ['ド6', '1047'],
]

// stackchan-voice singing notes use equal-tempered note names rather than Hz.
// Keep the beginner-facing labels aligned with the tone block while exposing
// chromatic pitches for melodies that leave C major.
export const SINGING_NOTE_OPTIONS = [
  ['ド4', 'C4'],
  ['ド♯4', 'C+4'],
  ['レ4', 'D4'],
  ['レ♯4', 'D+4'],
  ['ミ4', 'E4'],
  ['ファ4', 'F4'],
  ['ファ♯4', 'F+4'],
  ['ソ4', 'G4'],
  ['ソ♯4', 'G+4'],
  ['ラ4', 'A4'],
  ['ラ♯4', 'A+4'],
  ['シ4', 'B4'],
  ['ド5', 'C5'],
  ['ド♯5', 'C+5'],
  ['レ5', 'D5'],
  ['レ♯5', 'D+5'],
  ['ミ5', 'E5'],
  ['ファ5', 'F5'],
  ['ファ♯5', 'F+5'],
  ['ソ5', 'G5'],
  ['ソ♯5', 'G+5'],
  ['ラ5', 'A5'],
  ['ラ♯5', 'A+5'],
  ['シ5', 'B5'],
  ['ド6', 'C6'],
]

const BLOCK_STYLE = {
  event: 290,
  face: 20,
  speech: 160,
  motion: 230,
  light: 60,
  ui: 200,
  util: 330,
}

const BLOCK_DEFINITIONS = [
  {
    type: 'stackchan_on_start',
    message0: 'スタートしたとき %1 %2',
    args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
    colour: BLOCK_STYLE.event,
    tooltip: 'MODが起動したときに実行します',
  },
  {
    type: 'stackchan_on_button',
    message0: 'ボタン %1 が %2 とき %3 %4',
    args0: [
      {
        type: 'field_dropdown',
        name: 'BUTTON',
        options: [
          ['A', 'a'],
          ['B', 'b'],
          ['C', 'c'],
        ],
      },
      {
        type: 'field_dropdown',
        name: 'EDGE',
        options: [
          ['押された', 'press'],
          ['離された', 'release'],
        ],
      },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    colour: BLOCK_STYLE.event,
    tooltip: '本体のボタンが押された/離されたときに実行します',
  },
  {
    type: 'stackchan_on_imu',
    message0: '本体が %1 とき %2 %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'MOTION',
        options: [
          ['ゆさぶられた', 'shake'],
          ['前に倒れた', 'fallenForward'],
          ['後ろに倒れた', 'fallenBackward'],
          ['左に倒れた', 'fallenLeft'],
          ['右に倒れた', 'fallenRight'],
          ['さかさまになった', 'upsideDown'],
        ],
      },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    colour: BLOCK_STYLE.event,
    tooltip: '本体を動かしたとき(加速度センサー)に実行します',
  },
  {
    type: 'stackchan_on_head_touch',
    message0: '頭部タッチセンサが %1 とき %2 %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'GESTURE',
        options: [
          ['タッチされた', 'press'],
          ['はなされた', 'release'],
          ['前方へスワイプされた', 'forwardSwipe'],
          ['後方へスワイプされた', 'backwardSwipe'],
          ['なでられた', 'petting'],
        ],
      },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    colour: BLOCK_STYLE.event,
    tooltip: '頭上の静電容量式タッチセンサを操作したときに実行します',
  },
  {
    type: 'stackchan_on_drawer_button',
    message0: 'ドロワーに %1 ボタンをつくって 押されたら %2 %3',
    args0: [
      { type: 'field_input', name: 'LABEL', text: 'ボタン' },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    colour: BLOCK_STYLE.event,
    tooltip: '画面のドロワー(引き出しメニュー)にボタンを追加し、押されたときに実行します',
  },
  {
    type: 'stackchan_every',
    message0: '%1 秒ごとに %2 %3',
    args0: [
      { type: 'field_number', name: 'SECONDS', value: 5, min: 0.1, precision: 0.1 },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    colour: BLOCK_STYLE.event,
    tooltip: '一定時間ごとにくり返し実行します',
  },
  {
    type: 'stackchan_set_emotion',
    message0: '表情を %1 にする',
    args0: [{ type: 'field_dropdown', name: 'EMOTION', options: EMOTION_OPTIONS }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.face,
    tooltip: 'ｽﾀｯｸﾁｬﾝの表情を変えます',
  },
  {
    type: 'stackchan_set_color',
    message0: '顔の %1 の色を %2 にする',
    args0: [
      {
        type: 'field_dropdown',
        name: 'KEY',
        options: [
          ['線', 'primary'],
          ['背景', 'secondary'],
        ],
      },
      { type: 'field_dropdown', name: 'COLOR', options: COLOR_OPTIONS },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.face,
    tooltip: '顔の色を変えます',
  },
  {
    type: 'stackchan_set_mouth',
    message0: '口を %1 ひらく (0〜1)',
    args0: [{ type: 'field_number', name: 'VALUE', value: 0.5, min: 0, max: 1, precision: 0.1 }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.face,
    tooltip: '口のひらき具合を変えます',
  },
  {
    type: 'stackchan_say',
    message0: '%1 としゃべる',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.speech,
    tooltip: '音声合成でしゃべります(しゃべり終わるまで待ちます)',
  },
  {
    type: 'stackchan_sing_score',
    message0: 'テンポ %1 で %2 を歌う',
    args0: [
      { type: 'field_number', name: 'BPM', value: 120, min: 20, max: 300, precision: 1 },
      { type: 'input_value', name: 'SCORE', check: 'Array' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.speech,
    tooltip: '音階、拍、歌詞のトリプルを並べたリストをstackchan-voiceで歌います',
  },
  {
    type: 'stackchan_song_note_tuple',
    message0: '音符 %1 を %2 拍で「%3」と歌う',
    args0: [
      { type: 'field_dropdown', name: 'NOTE', options: SINGING_NOTE_OPTIONS },
      { type: 'field_number', name: 'BEATS', value: 1, min: 0.125, max: 16, precision: 0.125 },
      { type: 'field_input', name: 'LYRIC', text: 'き' },
    ],
    output: 'Array',
    colour: BLOCK_STYLE.speech,
    tooltip: '歌唱リストへ入れる［音階、拍、かな1モーラ］のトリプルです',
  },
  {
    type: 'stackchan_song_rest_tuple',
    message0: '%1 拍の休符',
    args0: [{ type: 'field_number', name: 'BEATS', value: 1, min: 0.125, max: 16, precision: 0.125 }],
    output: 'Array',
    colour: BLOCK_STYLE.speech,
    tooltip: '歌唱リストへ入れる［R、拍、空の歌詞］のトリプルです',
  },
  {
    type: 'stackchan_show_balloon',
    message0: 'ふきだしで %1 を表示',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.speech,
    tooltip: 'ふきだしにテキストを表示します',
  },
  {
    type: 'stackchan_hide_balloon',
    message0: 'ふきだしを消す',
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.speech,
    tooltip: 'ふきだしを消します',
  },
  {
    type: 'stackchan_tone',
    message0: '音 %1 を %2 ミリ秒ならす',
    args0: [
      { type: 'field_dropdown', name: 'NOTE', options: NOTE_OPTIONS },
      { type: 'field_number', name: 'DURATION', value: 300, min: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.speech,
    tooltip: 'ドレミの音をならします',
  },
  {
    type: 'stackchan_look_at',
    message0: '前 %1 左 %2 上 %3 の方を見る',
    args0: [
      { type: 'field_number', name: 'X', value: 1 },
      { type: 'field_number', name: 'Y', value: 0 },
      { type: 'field_number', name: 'Z', value: 0 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.motion,
    tooltip: '指定した方向(メートル)に顔と視線を向けます',
  },
  {
    type: 'stackchan_look_away',
    message0: 'よそ見をやめる',
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.motion,
    tooltip: '視線追従をやめて正面にもどります',
  },
  {
    type: 'stackchan_set_torque',
    message0: 'サーボの力を %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'TORQUE',
        options: [
          ['入れる', 'true'],
          ['抜く', 'false'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.motion,
    tooltip: 'サーボモーターのトルクを切り替えます',
  },
  {
    type: 'stackchan_set_pose',
    message0: '頭を 上下 %1 度 左右 %2 度 に向ける %3 秒かけて',
    args0: [
      { type: 'field_number', name: 'PITCH', value: 0, min: -60, max: 60 },
      { type: 'field_number', name: 'YAW', value: 0, min: -60, max: 60 },
      { type: 'field_number', name: 'TIME', value: 0.5, min: 0, precision: 0.1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.motion,
    tooltip: '頭の向きを指定した角度に動かします(動き終わるまで待ちます)',
  },
  {
    type: 'stackchan_light_on',
    message0: 'LED %1 を %2 で点ける',
    args0: [
      { type: 'field_input', name: 'NAME', text: 'a' },
      { type: 'field_dropdown', name: 'COLOR', options: COLOR_OPTIONS },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.light,
    tooltip: 'LEDを点灯します(LEDがある機種のみ)',
  },
  {
    type: 'stackchan_light_off',
    message0: 'LED %1 を消す',
    args0: [{ type: 'field_input', name: 'NAME', text: 'a' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.light,
    tooltip: 'LEDを消灯します',
  },
  {
    type: 'stackchan_light_rainbow',
    message0: 'LED %1 を虹色に光らせる',
    args0: [{ type: 'field_input', name: 'NAME', text: 'a' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.light,
    tooltip: 'LEDをレインボー点灯します',
  },
  {
    type: 'stackchan_light_blink',
    message0: 'LED %1 を %2 で %3 ミリ秒ごとに点滅',
    args0: [
      { type: 'field_input', name: 'NAME', text: 'a' },
      { type: 'field_dropdown', name: 'COLOR', options: COLOR_OPTIONS },
      { type: 'field_number', name: 'INTERVAL', value: 250, min: 100, max: 86400000 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.light,
    tooltip: 'LEDを点滅させます(LEDがある機種のみ)',
  },
  {
    type: 'stackchan_drawer_control',
    message0: 'ドロワーを %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'ACTION',
        options: [
          ['開く', 'openDrawer'],
          ['閉じる', 'closeDrawer'],
          ['切り替える', 'toggleDrawer'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.ui,
    tooltip: '画面のドロワー(引き出しメニュー)を開閉します',
  },
  {
    type: 'stackchan_show_face',
    message0: 'かおにもどす',
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.ui,
    tooltip: 'メイン画面をかおの表示にもどします',
  },
  {
    type: 'stackchan_wait',
    message0: '%1 ミリ秒まつ',
    args0: [{ type: 'field_number', name: 'DURATION', value: 1000, min: 0 }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.util,
    tooltip: '指定した時間だけ待ちます',
  },
  {
    type: 'stackchan_trace',
    message0: 'ログに %1 を出す',
    args0: [{ type: 'input_value', name: 'TEXT' }],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.util,
    tooltip: 'デバッグログに出力します',
  },
  {
    type: 'stackchan_random',
    message0: '%1 から %2 のランダムな数',
    args0: [
      { type: 'field_number', name: 'MIN', value: 0 },
      { type: 'field_number', name: 'MAX', value: 1 },
    ],
    output: 'Number',
    colour: BLOCK_STYLE.util,
    tooltip: '範囲内のランダムな数を返します',
  },
]

function localizeBlocklyData(value, key = '') {
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string') {
      return [t(value[0]), value[1]]
    }
    return value.map((item) => localizeBlocklyData(item))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => {
      if (typeof childValue === 'string' && ['message0', 'tooltip', 'text', 'name'].includes(childKey)) {
        return [childKey, t(childValue)]
      }
      return [childKey, localizeBlocklyData(childValue, childKey)]
    })
  )
}

// Escape a value for embedding inside a single-quoted JS string literal. Used
// for `field_input` values (e.g. the LED NAME) so a name containing ' or \
// cannot break the generated source.
export function escapeSingleQuoted(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function asyncHandlerBody(generator, block) {
  const body = generator.statementToCode(block, 'DO')
  return body.replace(/\s+$/, '')
}

// Returning the handler promise lets AppSession suppress overlap and cancel its operations.
function eventHandler(body, errorTag, blockId, parameters = 'task') {
  return `async (${parameters}) => {
  const visualLoopGuard = createVisualLoopGuard()
  try {
${body.replace(/^/gm, '    ')}
  } catch (error) {
    if (!task.signal.reason) reportVisualError('VP_RUNTIME_HANDLER', '${escapeSingleQuoted(blockId)}', error, '${escapeSingleQuoted(errorTag)}')
  }
}`
}

/** Refresh the localized block definitions without re-registering generators. */
export function defineStackchanBlocks(Blockly) {
  Blockly.defineBlocksWithJsonArray(localizeBlocklyData(BLOCK_DEFINITIONS))
}

/**
 * Register Stack-chan blocks and their JavaScript generators.
 * `Blockly` is the UMD global; `generator` is javascript.javascriptGenerator.
 */
export function registerStackchanBlocks(Blockly, generator, Order) {
  configureVisualGenerator(generator)
  defineStackchanBlocks(Blockly)

  const forBlock = generator.forBlock ?? generator

  forBlock['stackchan_on_start'] = (block, gen) =>
    `app.time.after(0, ${eventHandler(asyncHandlerBody(gen, block), 'start', block.id)})\n`

  forBlock['stackchan_on_button'] = (block, gen) => {
    const name = { a: 'primary', b: 'secondary', c: 'tertiary' }[block.getFieldValue('BUTTON')]
    const method = block.getFieldValue('EDGE') === 'release' ? 'onRelease' : 'onPress'
    return `input(app).${method}('${name}', ${eventHandler(asyncHandlerBody(gen, block), 'button', block.id)})\n`
  }

  forBlock['stackchan_on_imu'] = (block, gen) => {
    const body = `if (event.motion !== '${block.getFieldValue('MOTION')}') return\n${asyncHandlerBody(gen, block)}`
    return `input(app).onMotion(${eventHandler(body, 'motion input', block.id, 'event, task')})\n`
  }

  forBlock['stackchan_on_head_touch'] = (block, gen) => {
    return `input(app).onHeadTouch(${eventHandler(asyncHandlerBody(gen, block), 'head touch', block.id, 'event, task')}, { gesture: '${block.getFieldValue('GESTURE')}' })\n`
  }

  forBlock['stackchan_on_drawer_button'] = (block, gen) =>
    `ui(app).addAction({ id: '${escapeSingleQuoted(block.id)}', label: '${escapeSingleQuoted(block.getFieldValue('LABEL'))}' }, ${eventHandler(asyncHandlerBody(gen, block), 'menu', block.id)})\n`

  forBlock['stackchan_every'] = (block, gen) =>
    `app.time.every(${Math.max(1, Math.round(Number(block.getFieldValue('SECONDS')) * 1000))}, ${eventHandler(asyncHandlerBody(gen, block), 'timer', block.id)})\n`

  forBlock['stackchan_set_emotion'] = (block) => {
    return `app.face.setEmotion('${block.getFieldValue('EMOTION') === 'DOUBTFUL' ? 'doubt' : block.getFieldValue('EMOTION').toLowerCase()}')\n`
  }

  forBlock['stackchan_set_color'] = (block) => {
    const key = block.getFieldValue('KEY')
    const color = block.getFieldValue('COLOR')
    return `app.face.setColor('${key}', hexToRgb('${color}'))\n`
  }

  forBlock['stackchan_set_mouth'] = (block) => {
    return `app.face.setMouthOpen(${Number(block.getFieldValue('VALUE'))})\n`
  }

  forBlock['stackchan_say'] = (block, gen) => {
    const text = gen.valueToCode(block, 'TEXT', Order.NONE) || "''"
    return `await app.audio.say(String(${text}), { signal: task.signal })\n`
  }

  forBlock['stackchan_sing_score'] = (block, gen) => {
    const bpm = Number(block.getFieldValue('BPM'))
    const score = gen.valueToCode(block, 'SCORE', Order.NONE) || '[]'
    return `await singing(app).sing(${bpm}, ${score}, { signal: task.signal })\n`
  }

  forBlock['stackchan_song_note_tuple'] = (block) => {
    const note = escapeSingleQuoted(block.getFieldValue('NOTE'))
    const beats = Number(block.getFieldValue('BEATS'))
    const lyric = escapeSingleQuoted(block.getFieldValue('LYRIC'))
    return [`['${note}', ${beats}, '${lyric}']`, Order.ATOMIC ?? Order.NONE]
  }

  forBlock['stackchan_song_rest_tuple'] = (block) => {
    const beats = Number(block.getFieldValue('BEATS'))
    return [`['R', ${beats}, '']`, Order.ATOMIC ?? Order.NONE]
  }

  forBlock['stackchan_show_balloon'] = (block, gen) => {
    const text = gen.valueToCode(block, 'TEXT', Order.NONE) || "''"
    return `app.ui.showBalloon(String(${text}))\n`
  }

  forBlock['stackchan_hide_balloon'] = () => `app.ui.hideBalloon()\n`

  forBlock['stackchan_tone'] = (block) => {
    const note = Number(block.getFieldValue('NOTE'))
    const duration = Number(block.getFieldValue('DURATION'))
    return `await app.audio.tone(${note}, { durationMs: ${duration}, signal: task.signal })\n`
  }

  forBlock['stackchan_look_at'] = (block) => {
    const x = Number(block.getFieldValue('X'))
    const y = Number(block.getFieldValue('Y'))
    const z = Number(block.getFieldValue('Z'))
    if (x === 0 && y === 0 && z === 0) throw new RangeError('視線の方向を指定してください')
    return `app.motion.lookAt({ yawDeg: ${(Math.atan2(y, x) * 180) / Math.PI}, pitchDeg: ${(-Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI} })\n`
  }

  forBlock['stackchan_look_away'] = () => `app.motion.lookAway()\n`

  forBlock['stackchan_set_torque'] = (block) => {
    return `await app.motion.${block.getFieldValue('TORQUE') === 'true' ? 'hold' : 'relax'}()\n`
  }

  forBlock['stackchan_set_pose'] = (block) => {
    const pitch = Number(block.getFieldValue('PITCH'))
    const yaw = Number(block.getFieldValue('YAW'))
    const time = Number(block.getFieldValue('TIME'))
    return `await app.motion.move({ pitchDeg: ${pitch}, yawDeg: ${yaw} }, { durationMs: ${Math.round(time * 1000)}, signal: task.signal })\n`
  }

  forBlock['stackchan_light_on'] = (block) => {
    const name = escapeSingleQuoted(block.getFieldValue('NAME'))
    const color = block.getFieldValue('COLOR')
    return `lighting(app).color('${name}', hexToRgb('${color}'))\n`
  }

  forBlock['stackchan_light_off'] = (block) => {
    return `lighting(app).off('${escapeSingleQuoted(block.getFieldValue('NAME'))}')\n`
  }

  forBlock['stackchan_light_rainbow'] = (block) => {
    return `lighting(app).rainbow('${escapeSingleQuoted(block.getFieldValue('NAME'))}')\n`
  }

  forBlock['stackchan_light_blink'] = (block) => {
    const name = escapeSingleQuoted(block.getFieldValue('NAME'))
    const color = block.getFieldValue('COLOR')
    const interval = Number(block.getFieldValue('INTERVAL'))
    return `lighting(app).blink('${name}', hexToRgb('${color}'), { periodMs: ${interval} })\n`
  }

  forBlock['stackchan_drawer_control'] = (block) => {
    return `ui(app).${{ openDrawer: 'openMenu', closeDrawer: 'closeMenu', toggleDrawer: 'toggleMenu' }[block.getFieldValue('ACTION')]}()\n`
  }

  forBlock['stackchan_show_face'] = () => `ui(app).showFace()\n`

  forBlock['stackchan_wait'] = (block) => {
    return `await task.sleep(${Number(block.getFieldValue('DURATION'))})\n`
  }

  forBlock['stackchan_trace'] = (block, gen) => {
    const text = gen.valueToCode(block, 'TEXT', Order.NONE) || "''"
    return `trace(String(${text}) + '\\n')\n`
  }

  forBlock['stackchan_random'] = (block) => {
    const min = Number(block.getFieldValue('MIN'))
    const max = Number(block.getFieldValue('MAX'))
    return [`randomBetween(${min}, ${max})`, Order.FUNCTION_CALL]
  }

  registerAsyncProcedureGenerators(generator, Order)
}

export function configureVisualGenerator(generator) {
  generator.INFINITE_LOOP_TRAP = 'visualLoopGuard(%1);\n'
  generator.addReservedWords?.(VISUAL_RUNTIME_RESERVED_WORDS.join(','))
}

export function registerAsyncProcedureGenerators(generator, Order) {
  const forBlock = generator.forBlock ?? generator
  const definition = (block, gen) => {
    const functionName = gen.getProcedureName(block.getFieldValue('NAME'))
    let prefix = ''
    if (gen.STATEMENT_PREFIX) prefix += gen.injectId(gen.STATEMENT_PREFIX, block)
    if (gen.STATEMENT_SUFFIX) prefix += gen.injectId(gen.STATEMENT_SUFFIX, block)
    if (prefix) prefix = gen.prefixLines(prefix, gen.INDENT)

    let loopTrap = ''
    if (gen.INFINITE_LOOP_TRAP) {
      loopTrap = gen.prefixLines(gen.injectId(gen.INFINITE_LOOP_TRAP, block), gen.INDENT)
    }
    const branch = block.getInput('STACK') ? gen.statementToCode(block, 'STACK') : ''
    let returnValue = block.getInput('RETURN') ? gen.valueToCode(block, 'RETURN', Order.NONE) || '' : ''
    const suffixBeforeReturn = branch && returnValue ? prefix : ''
    if (returnValue) returnValue = `${gen.INDENT}return ${returnValue};\n`
    const args = [
      'visualLoopGuard',
      'task',
      ...block.getVarModels().map((variable) => gen.getVariableName(variable.getId())),
    ]
    const annotations = `/** @param {(blockId: string) => void} visualLoopGuard @param {import('stackchan').TaskContext} task ${args
      .slice(2)
      .map((name) => `@param {*} ${name}`)
      .join(' ')} */\n`
    let code =
      annotations +
      `async function ${functionName}(${args.join(', ')}) {\n` +
      prefix +
      loopTrap +
      branch +
      suffixBeforeReturn +
      returnValue +
      '}'
    code = gen.scrub_(block, code)
    gen.definitions_[`%${functionName}`] = code
    return null
  }

  forBlock.procedures_defreturn = definition
  forBlock.procedures_defnoreturn = definition
  forBlock.procedures_callreturn = (block, gen) => {
    const functionName = gen.getProcedureName(block.getFieldValue('NAME'))
    const args = [
      'visualLoopGuard',
      'task',
      ...block.getVarModels().map((_variable, index) => gen.valueToCode(block, `ARG${index}`, Order.NONE) || 'null'),
    ]
    return [`await ${functionName}(${args.join(', ')})`, Order.AWAIT ?? Order.FUNCTION_CALL]
  }
  forBlock.procedures_callnoreturn = (block, gen) => {
    const [code] = forBlock.procedures_callreturn(block, gen)
    return `${code};\n`
  }
}

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'イベント',
      colour: `${BLOCK_STYLE.event}`,
      contents: [
        { kind: 'block', type: 'stackchan_on_start' },
        { kind: 'block', type: 'stackchan_on_button' },
        { kind: 'block', type: 'stackchan_every' },
        { kind: 'block', type: 'stackchan_on_imu' },
        { kind: 'block', type: 'stackchan_on_head_touch' },
        { kind: 'block', type: 'stackchan_on_drawer_button' },
      ],
    },
    {
      kind: 'category',
      name: 'かお',
      colour: `${BLOCK_STYLE.face}`,
      contents: [
        { kind: 'block', type: 'stackchan_set_emotion' },
        { kind: 'block', type: 'stackchan_set_color' },
        { kind: 'block', type: 'stackchan_set_mouth' },
      ],
    },
    {
      kind: 'category',
      name: 'おしゃべり',
      colour: `${BLOCK_STYLE.speech}`,
      contents: [
        {
          kind: 'block',
          type: 'stackchan_say',
          inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'こんにちは' } } } },
        },
        {
          kind: 'block',
          type: 'stackchan_sing_score',
          inputs: {
            SCORE: {
              block: {
                type: 'lists_create_with',
                extraState: { itemCount: 4 },
                inputs: {
                  ADD0: {
                    block: {
                      type: 'stackchan_song_note_tuple',
                      fields: { NOTE: 'C4', BEATS: 1, LYRIC: 'き' },
                    },
                  },
                  ADD1: {
                    block: {
                      type: 'stackchan_song_note_tuple',
                      fields: { NOTE: 'C4', BEATS: 1, LYRIC: 'ら' },
                    },
                  },
                  ADD2: {
                    block: {
                      type: 'stackchan_song_note_tuple',
                      fields: { NOTE: 'G4', BEATS: 1, LYRIC: 'き' },
                    },
                  },
                  ADD3: {
                    block: {
                      type: 'stackchan_song_note_tuple',
                      fields: { NOTE: 'G4', BEATS: 1, LYRIC: 'ら' },
                    },
                  },
                },
              },
            },
          },
        },
        { kind: 'block', type: 'stackchan_song_note_tuple' },
        { kind: 'block', type: 'stackchan_song_rest_tuple' },
        {
          kind: 'block',
          type: 'stackchan_show_balloon',
          inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'やあ!' } } } },
        },
        { kind: 'block', type: 'stackchan_hide_balloon' },
        { kind: 'block', type: 'stackchan_tone' },
      ],
    },
    {
      kind: 'category',
      name: 'うごき',
      colour: `${BLOCK_STYLE.motion}`,
      contents: [
        { kind: 'block', type: 'stackchan_look_at' },
        { kind: 'block', type: 'stackchan_look_away' },
        { kind: 'block', type: 'stackchan_set_pose' },
        { kind: 'block', type: 'stackchan_set_torque' },
      ],
    },
    {
      kind: 'category',
      name: 'LED',
      colour: `${BLOCK_STYLE.light}`,
      contents: [
        { kind: 'block', type: 'stackchan_light_on' },
        { kind: 'block', type: 'stackchan_light_off' },
        { kind: 'block', type: 'stackchan_light_rainbow' },
        { kind: 'block', type: 'stackchan_light_blink' },
      ],
    },
    {
      kind: 'category',
      name: 'がめん',
      colour: `${BLOCK_STYLE.ui}`,
      contents: [
        { kind: 'block', type: 'stackchan_drawer_control' },
        { kind: 'block', type: 'stackchan_show_face' },
      ],
    },
    {
      kind: 'category',
      name: 'どうぐ',
      colour: `${BLOCK_STYLE.util}`,
      contents: [
        { kind: 'block', type: 'stackchan_wait' },
        {
          kind: 'block',
          type: 'stackchan_trace',
          inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'debug' } } } },
        },
        { kind: 'block', type: 'stackchan_random' },
      ],
    },
    { kind: 'sep' },
    {
      kind: 'category',
      name: 'ロジック',
      categorystyle: 'logic_category',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
      ],
    },
    {
      kind: 'category',
      name: 'くり返し',
      categorystyle: 'loop_category',
      contents: [
        {
          kind: 'block',
          type: 'controls_repeat_ext',
          inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 3 } } } },
        },
        { kind: 'block', type: 'controls_whileUntil' },
      ],
    },
    {
      kind: 'category',
      name: '数',
      categorystyle: 'math_category',
      contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_round' },
      ],
    },
    {
      kind: 'category',
      name: 'テキスト',
      categorystyle: 'text_category',
      contents: [
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'text_join' },
      ],
    },
    {
      kind: 'category',
      name: 'リスト',
      categorystyle: 'list_category',
      contents: [
        { kind: 'block', type: 'lists_create_with' },
        { kind: 'block', type: 'lists_length' },
        { kind: 'block', type: 'lists_getIndex' },
        { kind: 'block', type: 'lists_setIndex' },
      ],
    },
    { kind: 'category', name: '変数', categorystyle: 'variable_category', custom: 'VARIABLE' },
    { kind: 'category', name: '関数', categorystyle: 'procedure_category', custom: 'PROCEDURE' },
  ],
}

export function localizedToolbox() {
  return localizeBlocklyData(TOOLBOX)
}

/**
 * Generate the complete mod.js source from a Blockly workspace.
 */
export function generateModSource(generator, workspace) {
  const body = generator.workspaceToCode(workspace)
  return assembleModSource(body.replace(/\s+$/, ''))
}
