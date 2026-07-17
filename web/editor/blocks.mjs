/**
 * Stack-chan Blockly blocks and JavaScript code generation.
 *
 * The generated program is a Stack-chan MOD module: the workspace code becomes
 * the body of `export async function onContextCreated(robot)`. Event blocks
 * (start / button / interval) register handlers on the robot context.
 */

export const VISUAL_RUNTIME_RESERVED_WORDS = Object.freeze([
  'robot',
  'Timer',
  'Emotion',
  'wait',
  'randomBetween',
  'hexToRgb',
  'trace',
  'createVisualLoopGuard',
  'visualLoopGuard',
  'reportVisualError',
  'createVisualRuntime',
  'runtime',
  'onButton',
  'onImu',
  'onTouchPanel',
  'SINGING_MORA_TO_KOE',
  'STACKCHAN_VOICE_MAX_KOE_LENGTH',
  'katakanaToHiragana',
  'singingMoraToKoe',
  'songDurationMilliseconds',
  'singingScoreToKoe',
  'singScore',
  'event',
  '_StackchanVisualShapeFace',
])

const HELPER_HEX_TO_RGB = `function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}`

const HELPER_VISUAL_RUNTIME = `function createVisualLoopGuard() {
  let visualLoopBudget = 10000
  return function visualLoopGuard(blockId) {
    if (--visualLoopBudget <= 0) {
      const error = new Error('ループの実行上限を超えました')
      error.visualBlockId = blockId
      throw error
    }
  }
}

function reportVisualError(errorCode, blockId, error, context = '') {
  trace('#stackchan ' + JSON.stringify({
    schema_version: 1,
    component: 'visual-programming',
    event: 'error',
    error_code: errorCode,
    block_id: error?.visualBlockId || blockId,
    message: (context ? context + ': ' : '') + String(error),
  }) + '\\n')
}

function createVisualRuntime(robot) {
  robot.__visualProgram?.dispose?.()
  const disposers = []
  const runtime = {
    add(disposer) {
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    addTimer(timer) {
      runtime.add(() => Timer.clear(timer))
      return timer
    },
    dispose() {
      while (disposers.length) {
        try { disposers.pop()() } catch (error) { reportVisualError('VP_LIFECYCLE_CLEANUP', '', error) }
      }
    },
  }
  robot.__visualProgram = runtime
  return runtime
}`

// Event dispatch helpers. A driver exposes a single \`onEvent\`, so multiple
// blocks for the same driver (e.g. button press + release, or several IMU
// motions) must share one handler. Each helper stores per-key handlers on the
// driver object and installs one dispatching \`onEvent\` the first time.
const HELPER_ON_BUTTON = `function onButton(robot, name, edge, handler) {
  const button = robot.input.button?.[name]
  if (!button) return undefined
  const handlers = (button.__handlers ??= {})
  const callbacks = (handlers[edge] ??= new Set())
  callbacks.add(handler)
  if (!button.__visualWired) {
    button.__visualWired = true
    button.__visualPrevious = button.onEvent
    button.onEvent = (event) => {
      for (const callback of [...(button.__handlers?.[event.pressed ? 'press' : 'release'] ?? [])]) callback(event)
      button.__visualPrevious?.(event)
    }
  }
  return () => {
    callbacks.delete(handler)
    if (callbacks.size === 0) delete handlers[edge]
    if (Object.keys(button.__handlers ?? {}).length === 0) {
      button.onEvent = button.__visualPrevious
      delete button.__visualPrevious
      button.__visualWired = false
    }
  }
}`

const HELPER_ON_IMU = `function onImu(robot, motion, handler) {
  const imu = robot.input.imu
  if (!imu) return undefined
  const handlers = (imu.__handlers ??= {})
  const callbacks = (handlers[motion] ??= new Set())
  callbacks.add(handler)
  if (!imu.__visualWired) {
    imu.__visualWired = true
    imu.__visualPrevious = imu.onEvent
    imu.onEvent = (event) => {
      for (const callback of [...(imu.__handlers?.[event.motion] ?? [])]) callback(event)
      imu.__visualPrevious?.(event)
    }
    imu.start?.()
  }
  return () => {
    callbacks.delete(handler)
    if (callbacks.size === 0) delete handlers[motion]
    if (Object.keys(imu.__handlers ?? {}).length === 0) {
      imu.onEvent = imu.__visualPrevious
      delete imu.__visualPrevious
      imu.__visualWired = false
    }
  }
}`

const HELPER_ON_TOUCH_PANEL = `function onTouchPanel(robot, gesture, handler) {
  const panel = robot.input.touchPanel
  if (!panel) return undefined
  const handlers = (panel.__handlers ??= {})
  const callbacks = (handlers[gesture] ??= new Set())
  callbacks.add(handler)
  if (!panel.__visualWired) {
    panel.__visualWired = true
    panel.__visualPrevious = panel.onEvent
    panel.onEvent = (event) => {
      for (const callback of [...(panel.__handlers?.[event.gesture] ?? [])]) callback(event)
      panel.__visualPrevious?.(event)
    }
  }
  return () => {
    callbacks.delete(handler)
    if (callbacks.size === 0) delete handlers[gesture]
    if (Object.keys(panel.__handlers ?? {}).length === 0) {
      panel.onEvent = panel.__visualPrevious
      delete panel.__visualPrevious
      panel.__visualWired = false
    }
  }
}`

/**
 * Wrap generated workspace code into a complete mod.js source.
 * Imports and helpers are included only when the body references them.
 */
export function assembleModSource(body) {
  const imports = []
  if (/\bTimer\s*\./.test(body)) imports.push("import Timer from 'timer'")
  const utilNames = ['randomBetween', 'wait'].filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(body))
  if (utilNames.length) imports.push(`import { ${utilNames.join(', ')} } from 'stackchan-util'`)
  if (/\bEmotion\s*\./.test(body)) imports.push("import { Emotion } from 'face-state'")

  const helpers = [HELPER_VISUAL_RUNTIME]
  if (/\bhexToRgb\s*\(/.test(body)) helpers.push(HELPER_HEX_TO_RGB)
  if (/\bonButton\s*\(/.test(body)) helpers.push(HELPER_ON_BUTTON)
  if (/\bonImu\s*\(/.test(body)) helpers.push(HELPER_ON_IMU)
  if (/\bonTouchPanel\s*\(/.test(body)) helpers.push(HELPER_ON_TOUCH_PANEL)
  if (/\bsingScore\s*\(/.test(body)) helpers.push(HELPER_SING_SCORE)

  const indentedBody = body
    .split('\n')
    .map((line) => (line.length ? `  ${line}` : line))
    .join('\n')
    .replace(/\s+$/, '')

  const sections = []
  if (imports.length) sections.push(imports.join('\n'))
  if (helpers.length) sections.push(helpers.join('\n\n'))
  sections.push(
    `export async function onContextCreated(robot) {\n  const runtime = createVisualRuntime(robot)\n  const visualLoopGuard = createVisualLoopGuard()\n${indentedBody}\n}`
  )
  return `${sections.join('\n\n')}\n`
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
// robot.audio.tone() takes Hz, so the value is the frequency directly.
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

const SINGING_MORA_TO_KOE = Object.freeze({
  あ: 'a',
  い: 'i',
  う: 'u',
  え: 'e',
  お: 'o',
  ぁ: 'a',
  ぃ: 'i',
  ぅ: 'u',
  ぇ: 'e',
  ぉ: 'o',
  か: 'ka',
  き: 'ki',
  く: 'ku',
  け: 'ke',
  こ: 'ko',
  が: 'ga',
  ぎ: 'gi',
  ぐ: 'gu',
  げ: 'ge',
  ご: 'go',
  さ: 'sa',
  し: 'shi',
  す: 'su',
  せ: 'se',
  そ: 'so',
  ざ: 'za',
  じ: 'ji',
  ず: 'zu',
  ぜ: 'ze',
  ぞ: 'zo',
  た: 'ta',
  ち: 'chi',
  つ: 'tsu',
  て: 'te',
  と: 'to',
  だ: 'da',
  ぢ: 'ji',
  づ: 'zu',
  で: 'de',
  ど: 'do',
  な: 'na',
  に: 'ni',
  ぬ: 'nu',
  ね: 'ne',
  の: 'no',
  は: 'ha',
  ひ: 'hi',
  ふ: 'fu',
  へ: 'he',
  ほ: 'ho',
  ば: 'ba',
  び: 'bi',
  ぶ: 'bu',
  べ: 'be',
  ぼ: 'bo',
  ぱ: 'pa',
  ぴ: 'pi',
  ぷ: 'pu',
  ぺ: 'pe',
  ぽ: 'po',
  ま: 'ma',
  み: 'mi',
  む: 'mu',
  め: 'me',
  も: 'mo',
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  ら: 'ra',
  り: 'ri',
  る: 'ru',
  れ: 're',
  ろ: 'ro',
  わ: 'wa',
  ゐ: 'i',
  ゑ: 'e',
  を: 'o',
  ん: 'n',
  きゃ: 'kya',
  きゅ: 'kyu',
  きょ: 'kyo',
  ぎゃ: 'gya',
  ぎゅ: 'gyu',
  ぎょ: 'gyo',
  しゃ: 'sha',
  しゅ: 'shu',
  しょ: 'sho',
  じゃ: 'ja',
  じゅ: 'ju',
  じょ: 'jo',
  ちゃ: 'cha',
  ちゅ: 'chu',
  ちょ: 'cho',
  にゃ: 'nya',
  にゅ: 'nyu',
  にょ: 'nyo',
  ひゃ: 'hya',
  ひゅ: 'hyu',
  ひょ: 'hyo',
  びゃ: 'bya',
  びゅ: 'byu',
  びょ: 'byo',
  ぴゃ: 'pya',
  ぴゅ: 'pyu',
  ぴょ: 'pyo',
  みゃ: 'mya',
  みゅ: 'myu',
  みょ: 'myo',
  りゃ: 'rya',
  りゅ: 'ryu',
  りょ: 'ryo',
  ふぁ: 'fa',
  ふぃ: 'fi',
  ふぇ: 'fe',
  ふぉ: 'fo',
  てぃ: 'ti',
  とぅ: 'tu',
  でぃ: 'di',
  どぅ: 'du',
  しぇ: 'she',
  ちぇ: 'che',
  じぇ: 'je',
  うぃ: 'wi',
  うぇ: 'we',
  うぉ: 'o',
  ゔ: 'vu',
  ゔぁ: 'va',
  ゔぃ: 'vi',
  ゔぇ: 've',
  ゔぉ: 'vo',
  きぇ: 'kye',
  ぎぇ: 'gye',
  いぇ: 'ye',
  ひぇ: 'hye',
  びぇ: 'bye',
  ぴぇ: 'pye',
  みぇ: 'mye',
  にぇ: 'nye',
  りぇ: 'rye',
  てゅ: 'tyu',
  でゅ: 'dyu',
  でゃ: 'dya',
  でょ: 'dyo',
  てゃ: 'tya',
  てょ: 'tyo',
  つぁ: 'tsa',
  つぃ: 'tsi',
  つぇ: 'tse',
  つぉ: 'tso',
  すぃ: 'si',
  ずぃ: 'zi',
  ふゅ: 'fyu',
  ゔゅ: 'vyu',
  ゕ: 'ka',
  ゖ: 'ke',
  ゎ: 'wa',
})

const STACKCHAN_VOICE_MAX_KOE_LENGTH = 2047

function katakanaToHiragana(value) {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0)
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : character
    })
    .join('')
}

/** Convert exactly one kana mora from a singing block into raw koe notation. */
export function singingMoraToKoe(value, previousMora = '') {
  const input = String(value).trim()
  const mora = katakanaToHiragana(input)
  if (mora === 'ー') {
    const previousVowel = /[aiueo]$/.exec(previousMora)?.[0]
    if (previousVowel) return previousVowel
    throw new RangeError('長音「ー」の前には母音を持つ歌詞が必要です')
  }
  const koe = SINGING_MORA_TO_KOE[mora]
  if (koe) return koe
  throw new RangeError(`歌詞「${input || '（空）'}」は、かな1モーラで入力してください`)
}

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
    type: 'stackchan_on_touch',
    message0: '画面が %1 されたとき %2 %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'GESTURE',
        options: [
          ['タッチ', 'press'],
          ['はなす', 'release'],
          ['右にスワイプ', 'forwardSwipe'],
          ['左にスワイプ', 'backwardSwipe'],
        ],
      },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    colour: BLOCK_STYLE.event,
    tooltip: '画面(タッチパネル)を操作したときに実行します',
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
    type: 'stackchan_sing',
    message0: 'テンポ %1 で歌う %2 %3',
    args0: [
      { type: 'field_number', name: 'BPM', value: 120, min: 20, max: 300, precision: 1 },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'SCORE', check: 'StackchanSongEvent' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.speech,
    tooltip: '音符ごとの歌詞をstackchan-voiceで歌います',
  },
  {
    type: 'stackchan_song_note',
    message0: '音符 %1 を %2 拍で「%3」と歌う',
    args0: [
      { type: 'field_dropdown', name: 'NOTE', options: SINGING_NOTE_OPTIONS },
      { type: 'field_number', name: 'BEATS', value: 1, min: 0.125, max: 16, precision: 0.125 },
      { type: 'field_input', name: 'LYRIC', text: 'き' },
    ],
    previousStatement: 'StackchanSongEvent',
    nextStatement: 'StackchanSongEvent',
    colour: BLOCK_STYLE.speech,
    tooltip: 'かな1モーラを指定した音高と長さで歌います（例: き、きゃ、ん、ー）',
  },
  {
    type: 'stackchan_song_rest',
    message0: '%1 拍 休む',
    args0: [{ type: 'field_number', name: 'BEATS', value: 1, min: 0.125, max: 16, precision: 0.125 }],
    previousStatement: 'StackchanSongEvent',
    nextStatement: 'StackchanSongEvent',
    colour: BLOCK_STYLE.speech,
    tooltip: '指定した拍数だけ休符を入れます',
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
      { type: 'field_number', name: 'INTERVAL', value: 250, min: 1 },
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

// Escape a value for embedding inside a single-quoted JS string literal. Used
// for `field_input` values (e.g. the LED NAME) so a name containing ' or \
// cannot break the generated source.
export function escapeSingleQuoted(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function songDurationMilliseconds(beatsValue, bpm) {
  const beats = Number(beatsValue)
  if (!Number.isFinite(beats) || beats <= 0) throw new RangeError('音符と休符の拍数は0より大きくしてください')
  const duration = Math.round((60_000 * beats) / bpm)
  if (duration < 20 || duration > 8000) {
    throw new RangeError(`テンポ${bpm}では${beats}拍が${duration}ミリ秒になります（20〜8000ミリ秒にしてください）`)
  }
  return duration
}

/** Convert a score of [note, beats, lyric] triples into raw stackchan-voice koe notation. */
export function singingScoreToKoe(bpmValue, scoreValue) {
  const bpm = Number(bpmValue)
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
    throw new RangeError('歌うテンポは20〜300 BPMにしてください')
  }
  if (!Array.isArray(scoreValue)) throw new TypeError('歌唱データは音符と休符を並べたリストにしてください')
  if (scoreValue.length === 0) throw new RangeError('歌唱リストに音符または休符を追加してください')
  if (scoreValue.length > 256) throw new RangeError('1つの歌唱リストには音符と休符を256個まで置けます')

  let koe = ''
  let previousMora = ''
  for (let index = 0; index < scoreValue.length; index += 1) {
    const event = scoreValue[index]
    if (!Array.isArray(event) || event.length !== 3) {
      throw new TypeError(`${index + 1}番目の歌唱データは［音階、拍、歌詞］の3項目にしてください`)
    }
    const note = String(event[0] ?? '')
      .trim()
      .toUpperCase()
    const duration = songDurationMilliseconds(event[1], bpm)
    const lyric = String(event[2] ?? '').trim()
    if (note === 'R') {
      if (lyric) throw new RangeError(`${index + 1}番目の休符には歌詞を指定できません`)
      koe += `#R,${duration}`
    } else {
      if (!/^[A-G](?:[+-])?[0-8]$/.test(note)) {
        throw new RangeError(`${index + 1}番目の歌唱音符「${note || '（空）'}」が不正です`)
      }
      const mora = singingMoraToKoe(lyric, previousMora)
      koe += `#${note},${duration}${mora}`
      previousMora = mora
    }
    if (koe.length > STACKCHAN_VOICE_MAX_KOE_LENGTH) {
      throw new RangeError('歌が長すぎます。歌唱リストを複数の歌うブロックに分けてください')
    }
  }
  return koe
}

async function singScore(robot, bpm, score) {
  const koe = singingScoreToKoe(bpm, score)
  const result = await robot.audio.sing(koe)
  if (!result?.success) throw new Error(result?.reason || '歌唱に失敗しました')
  return result
}

const HELPER_SING_SCORE = `const SINGING_MORA_TO_KOE = Object.freeze(${JSON.stringify(SINGING_MORA_TO_KOE)})

const STACKCHAN_VOICE_MAX_KOE_LENGTH = ${STACKCHAN_VOICE_MAX_KOE_LENGTH}

${katakanaToHiragana.toString()}

${singingMoraToKoe.toString()}

${songDurationMilliseconds.toString()}

${singingScoreToKoe.toString()}

${singScore.toString()}`

function singingKoeFromBlock(block) {
  const bpm = Number(block.getFieldValue('BPM'))
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
    throw new RangeError('歌うテンポは20〜300 BPMにしてください')
  }

  let event = block.getInputTargetBlock?.('SCORE')
  let eventCount = 0
  let koe = ''
  let previousMora = ''
  while (event) {
    eventCount += 1
    if (eventCount > 256) throw new RangeError('1つの歌うブロックには音符と休符を256個まで置けます')
    const duration = songDurationMilliseconds(event.getFieldValue('BEATS'), bpm)
    if (event.type === 'stackchan_song_note') {
      const note = String(event.getFieldValue('NOTE'))
      if (!/^[A-G](?:[+-])?[0-8]$/.test(note)) throw new RangeError(`歌唱音符「${note}」が不正です`)
      const mora = singingMoraToKoe(event.getFieldValue('LYRIC'), previousMora)
      koe += `#${note},${duration}${mora}`
      previousMora = mora
    } else if (event.type === 'stackchan_song_rest') {
      koe += `#R,${duration}`
    } else {
      throw new TypeError(`歌うブロック内に未対応のブロック「${event.type}」があります`)
    }
    if (koe.length > STACKCHAN_VOICE_MAX_KOE_LENGTH) {
      throw new RangeError('歌が長すぎます。1つの歌うブロックを複数に分けてください')
    }
    event = event.getNextBlock?.()
  }
  if (eventCount === 0) throw new RangeError('歌うブロックに音符または休符を追加してください')
  return koe
}

function legacySongEventCode(block) {
  let parent = block.getParent?.()
  while (parent) {
    if (parent.type === 'stackchan_sing') return ''
    parent = parent.getParent?.()
  }
  throw new Error(
    '旧形式の音符・休符ブロックは直接実行できません。トリプル形式の音符・休符をリストへ入れてください',
  )
}

function asyncHandlerBody(generator, block) {
  const body = generator.statementToCode(block, 'DO')
  return body.replace(/\s+$/, '')
}

// Build an event-handler arrow function that runs a statement body inside a
// fire-and-forget async IIFE (so `await` works and errors are traced).
// `param` is the callback parameter name ('event' for input events, '' for the
// drawer button which takes none).
function eventHandler(body, errorTag, blockId, param = 'event') {
  const indented = body.replace(/^/gm, '  ')
  return (
    `(${param}) => {\n` +
    `  void (async () => {\n` +
    `    const visualLoopGuard = createVisualLoopGuard()\n${indented}\n` +
    `  })().catch((error) => reportVisualError('VP_RUNTIME_HANDLER', '${escapeSingleQuoted(blockId)}', error, '${escapeSingleQuoted(errorTag)}'))\n` +
    `}`
  )
}

/**
 * Register Stack-chan blocks and their JavaScript generators.
 * `Blockly` is the UMD global; `generator` is javascript.javascriptGenerator.
 */
export function registerStackchanBlocks(Blockly, generator, Order) {
  configureVisualGenerator(generator)
  Blockly.defineBlocksWithJsonArray(BLOCK_DEFINITIONS)

  const forBlock = generator.forBlock ?? generator

  forBlock['stackchan_on_start'] = (block, gen) => {
    const body = asyncHandlerBody(gen, block)
    return `;(async () => {\n  const visualLoopGuard = createVisualLoopGuard()\n${body}\n})().catch((error) => reportVisualError('VP_RUNTIME_START', '${escapeSingleQuoted(block.id)}', error))\n`
  }

  forBlock['stackchan_on_button'] = (block, gen) => {
    const button = block.getFieldValue('BUTTON')
    const edge = block.getFieldValue('EDGE')
    const body = asyncHandlerBody(gen, block)
    return `runtime.add(onButton(robot, '${button}', '${edge}', ${eventHandler(body, `button ${button}`, block.id)}))\n`
  }

  forBlock['stackchan_on_imu'] = (block, gen) => {
    const motion = block.getFieldValue('MOTION')
    const body = asyncHandlerBody(gen, block)
    return `runtime.add(onImu(robot, '${motion}', ${eventHandler(body, 'imu', block.id)}))\n`
  }

  forBlock['stackchan_on_touch'] = (block, gen) => {
    const gesture = block.getFieldValue('GESTURE')
    const body = asyncHandlerBody(gen, block)
    return `runtime.add(onTouchPanel(robot, '${gesture}', ${eventHandler(body, 'touch', block.id)}))\n`
  }

  forBlock['stackchan_on_drawer_button'] = (block, gen) => {
    const label = escapeSingleQuoted(block.getFieldValue('LABEL'))
    const key = escapeSingleQuoted(block.id)
    const body = asyncHandlerBody(gen, block)
    return (
      `robot.ui.drawer?.addDrawerButton({ key: '${key}', label: '${label}', callback: ${eventHandler(body, 'drawer', block.id, '')} })\n` +
      `runtime.add(() => robot.ui.drawer?.removeDrawerButton?.('${key}'))\n`
    )
  }

  forBlock['stackchan_every'] = (block, gen) => {
    const seconds = Number(block.getFieldValue('SECONDS'))
    const interval = Math.max(1, Math.round(seconds * 1000))
    const body = asyncHandlerBody(gen, block)
    return (
      `runtime.addTimer(Timer.repeat(() => {\n` +
      `  void (async () => {\n` +
      `    const visualLoopGuard = createVisualLoopGuard()\n${body.replace(/^/gm, '  ')}\n` +
      `  })().catch((error) => reportVisualError('VP_RUNTIME_TIMER', '${escapeSingleQuoted(block.id)}', error))\n` +
      `}, ${interval}))\n`
    )
  }

  forBlock['stackchan_set_emotion'] = (block) => {
    return `robot.face.setEmotion(Emotion.${block.getFieldValue('EMOTION')})\n`
  }

  forBlock['stackchan_set_color'] = (block) => {
    const key = block.getFieldValue('KEY')
    const color = block.getFieldValue('COLOR')
    return `robot.face.setColor('${key}', ...hexToRgb('${color}'))\n`
  }

  forBlock['stackchan_set_mouth'] = (block) => {
    return `robot.face.setMouthOpen(${Number(block.getFieldValue('VALUE'))})\n`
  }

  forBlock['stackchan_say'] = (block, gen) => {
    const text = gen.valueToCode(block, 'TEXT', Order.NONE) || "''"
    return `await robot.audio.say(String(${text}))\n`
  }

  forBlock['stackchan_sing'] = (block) => {
    return `await robot.audio.sing('${escapeSingleQuoted(singingKoeFromBlock(block))}')\n`
  }

  forBlock['stackchan_sing_score'] = (block, gen) => {
    const bpm = Number(block.getFieldValue('BPM'))
    const score = gen.valueToCode(block, 'SCORE', Order.NONE) || '[]'
    return `await singScore(robot, ${bpm}, ${score})\n`
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

  // Keep the original statement-score blocks loadable for projects created
  // during PR development. They remain valid only inside the original parent;
  // a detached block now fails instead of silently generating an empty handler.
  forBlock['stackchan_song_note'] = legacySongEventCode
  forBlock['stackchan_song_rest'] = legacySongEventCode

  forBlock['stackchan_show_balloon'] = (block, gen) => {
    const text = gen.valueToCode(block, 'TEXT', Order.NONE) || "''"
    return `robot.ui.showBalloon(String(${text}))\n`
  }

  forBlock['stackchan_hide_balloon'] = () => `robot.ui.hideBalloon()\n`

  forBlock['stackchan_tone'] = (block) => {
    const note = Number(block.getFieldValue('NOTE'))
    const duration = Number(block.getFieldValue('DURATION'))
    return `await robot.audio.tone(${note}, ${duration})\n`
  }

  forBlock['stackchan_look_at'] = (block) => {
    const x = Number(block.getFieldValue('X'))
    const y = Number(block.getFieldValue('Y'))
    const z = Number(block.getFieldValue('Z'))
    return `robot.motion.lookAt([${x}, ${y}, ${z}])\n`
  }

  forBlock['stackchan_look_away'] = () => `robot.motion.lookAway()\n`

  forBlock['stackchan_set_torque'] = (block) => {
    return `await robot.motion.setTorque(${block.getFieldValue('TORQUE')})\n`
  }

  forBlock['stackchan_set_pose'] = (block) => {
    const pitch = Number(block.getFieldValue('PITCH'))
    const yaw = Number(block.getFieldValue('YAW'))
    const time = Number(block.getFieldValue('TIME'))
    return `await robot.motion.setPose({ rotation: { p: (${pitch} * Math.PI) / 180, y: (${yaw} * Math.PI) / 180, r: 0 } }, ${time})\n`
  }

  forBlock['stackchan_light_on'] = (block) => {
    const name = escapeSingleQuoted(block.getFieldValue('NAME'))
    const color = block.getFieldValue('COLOR')
    return `robot.lighting.lightOn('${name}', ...hexToRgb('${color}'))\n`
  }

  forBlock['stackchan_light_off'] = (block) => {
    return `robot.lighting.lightOff('${escapeSingleQuoted(block.getFieldValue('NAME'))}')\n`
  }

  forBlock['stackchan_light_rainbow'] = (block) => {
    return `robot.lighting.lightRainbow('${escapeSingleQuoted(block.getFieldValue('NAME'))}')\n`
  }

  forBlock['stackchan_light_blink'] = (block) => {
    const name = escapeSingleQuoted(block.getFieldValue('NAME'))
    const color = block.getFieldValue('COLOR')
    const interval = Number(block.getFieldValue('INTERVAL'))
    return `robot.lighting.lightBlink('${name}', ...hexToRgb('${color}'), ${interval})\n`
  }

  forBlock['stackchan_drawer_control'] = (block) => {
    return `robot.ui.${block.getFieldValue('ACTION')}()\n`
  }

  forBlock['stackchan_show_face'] = () => `robot.ui.showFace()\n`

  forBlock['stackchan_wait'] = (block) => {
    return `await wait(${Number(block.getFieldValue('DURATION'))})\n`
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
    const args = ['visualLoopGuard', ...block.getVars().map((variable) => gen.getVariableName(variable))]
    let code =
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
      ...block.getVars().map((_variable, index) => gen.valueToCode(block, `ARG${index}`, Order.NONE) || 'null'),
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
        { kind: 'block', type: 'stackchan_on_touch' },
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

/**
 * Generate the complete mod.js source from a Blockly workspace.
 */
export function generateModSource(generator, workspace) {
  const body = generator.workspaceToCode(workspace)
  return assembleModSource(body.replace(/\s+$/, ''))
}
