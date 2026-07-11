/**
 * Stack-chan Blockly blocks and JavaScript code generation.
 *
 * The generated program is a Stack-chan MOD module: the workspace code becomes
 * the body of `export async function onContextCreated(robot)`. Event blocks
 * (start / button / interval) register handlers on the robot context.
 */

const HELPER_HEX_TO_RGB = `function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}`

// Event dispatch helpers. A driver exposes a single \`onEvent\`, so multiple
// blocks for the same driver (e.g. button press + release, or several IMU
// motions) must share one handler. Each helper stores per-key handlers on the
// driver object and installs one dispatching \`onEvent\` the first time.
const HELPER_ON_BUTTON = `function onButton(robot, name, edge, handler) {
  const button = robot.input.button?.[name]
  if (!button) return
  ;(button.__handlers ??= {})[edge] = handler
  if (button.__wired) return
  button.__wired = true
  button.onEvent = (event) => button.__handlers[event.pressed ? 'press' : 'release']?.(event)
}`

const HELPER_ON_IMU = `function onImu(robot, motion, handler) {
  const imu = robot.input.imu
  if (!imu) return
  ;(imu.__handlers ??= {})[motion] = handler
  if (imu.__wired) return
  imu.__wired = true
  imu.onEvent = (event) => imu.__handlers[event.motion]?.(event)
  imu.start?.()
}`

const HELPER_ON_TOUCH_PANEL = `function onTouchPanel(robot, gesture, handler) {
  const panel = robot.input.touchPanel
  if (!panel) return
  ;(panel.__handlers ??= {})[gesture] = handler
  if (panel.__wired) return
  panel.__wired = true
  panel.onEvent = (event) => panel.__handlers[event.gesture]?.(event)
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

  const helpers = []
  if (/\bhexToRgb\s*\(/.test(body)) helpers.push(HELPER_HEX_TO_RGB)
  if (/\bonButton\s*\(/.test(body)) helpers.push(HELPER_ON_BUTTON)
  if (/\bonImu\s*\(/.test(body)) helpers.push(HELPER_ON_IMU)
  if (/\bonTouchPanel\s*\(/.test(body)) helpers.push(HELPER_ON_TOUCH_PANEL)

  const indentedBody = body
    .split('\n')
    .map((line) => (line.length ? `  ${line}` : line))
    .join('\n')
    .replace(/\s+$/, '')

  const sections = []
  if (imports.length) sections.push(imports.join('\n'))
  if (helpers.length) sections.push(helpers.join('\n\n'))
  sections.push(`export async function onContextCreated(robot) {\n${indentedBody}\n}`)
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
    message0: '高さ %1 Hzの音を %2 ミリ秒ならす',
    args0: [
      { type: 'field_number', name: 'FREQUENCY', value: 440, min: 20 },
      { type: 'field_number', name: 'DURATION', value: 200, min: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: BLOCK_STYLE.speech,
    tooltip: 'ブザー音をならします',
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
    message0: '頭を 上下 %1 度 左右 %2 度 かたむき %3 度 に向ける %4 秒かけて',
    args0: [
      { type: 'field_number', name: 'PITCH', value: 0, min: -60, max: 60 },
      { type: 'field_number', name: 'YAW', value: 0, min: -60, max: 60 },
      { type: 'field_number', name: 'ROLL', value: 0, min: -60, max: 60 },
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

function asyncHandlerBody(generator, block) {
  const body = generator.statementToCode(block, 'DO')
  return body.replace(/\s+$/, '')
}

// Build an event-handler arrow function that runs a statement body inside a
// fire-and-forget async IIFE (so `await` works and errors are traced).
// `param` is the callback parameter name ('event' for input events, '' for the
// drawer button which takes none).
function eventHandler(body, errorTag, param = 'event') {
  const indented = body.replace(/^/gm, '  ')
  return (
    `(${param}) => {\n` +
    `  void (async () => {\n${indented}\n` +
    `  })().catch((error) => trace('${errorTag} handler failed: ' + error + '\\n'))\n` +
    `}`
  )
}

/**
 * Register Stack-chan blocks and their JavaScript generators.
 * `Blockly` is the UMD global; `generator` is javascript.javascriptGenerator.
 */
export function registerStackchanBlocks(Blockly, generator, Order) {
  Blockly.defineBlocksWithJsonArray(BLOCK_DEFINITIONS)

  const forBlock = generator.forBlock ?? generator

  forBlock['stackchan_on_start'] = (block, gen) => {
    const body = asyncHandlerBody(gen, block)
    return `;(async () => {\n${body}\n})().catch((error) => trace('start handler failed: ' + error + '\\n'))\n`
  }

  forBlock['stackchan_on_button'] = (block, gen) => {
    const button = block.getFieldValue('BUTTON')
    const edge = block.getFieldValue('EDGE')
    const body = asyncHandlerBody(gen, block)
    return `onButton(robot, '${button}', '${edge}', ${eventHandler(body, `button ${button}`)})\n`
  }

  forBlock['stackchan_on_imu'] = (block, gen) => {
    const motion = block.getFieldValue('MOTION')
    const body = asyncHandlerBody(gen, block)
    return `onImu(robot, '${motion}', ${eventHandler(body, 'imu')})\n`
  }

  forBlock['stackchan_on_touch'] = (block, gen) => {
    const gesture = block.getFieldValue('GESTURE')
    const body = asyncHandlerBody(gen, block)
    return `onTouchPanel(robot, '${gesture}', ${eventHandler(body, 'touch')})\n`
  }

  forBlock['stackchan_on_drawer_button'] = (block, gen) => {
    const label = escapeSingleQuoted(block.getFieldValue('LABEL'))
    const key = escapeSingleQuoted(block.id)
    const body = asyncHandlerBody(gen, block)
    return `robot.ui.drawer?.addDrawerButton({ key: '${key}', label: '${label}', callback: ${eventHandler(body, 'drawer', '')} })\n`
  }

  forBlock['stackchan_every'] = (block, gen) => {
    const seconds = Number(block.getFieldValue('SECONDS'))
    const interval = Math.max(1, Math.round(seconds * 1000))
    const body = asyncHandlerBody(gen, block)
    return (
      `Timer.repeat(() => {\n` +
      `  void (async () => {\n${body.replace(/^/gm, '  ')}\n` +
      `  })().catch((error) => trace('timer handler failed: ' + error + '\\n'))\n` +
      `}, ${interval})\n`
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

  forBlock['stackchan_show_balloon'] = (block, gen) => {
    const text = gen.valueToCode(block, 'TEXT', Order.NONE) || "''"
    return `robot.ui.showBalloon(String(${text}))\n`
  }

  forBlock['stackchan_hide_balloon'] = () => `robot.ui.hideBalloon()\n`

  forBlock['stackchan_tone'] = (block) => {
    const frequency = Number(block.getFieldValue('FREQUENCY'))
    const duration = Number(block.getFieldValue('DURATION'))
    return `await robot.audio.tone(${frequency}, ${duration})\n`
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
    const roll = Number(block.getFieldValue('ROLL'))
    const time = Number(block.getFieldValue('TIME'))
    return `await robot.motion.setPose({ rotation: { p: (${pitch} * Math.PI) / 180, y: (${yaw} * Math.PI) / 180, r: (${roll} * Math.PI) / 180 } }, ${time})\n`
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
    { kind: 'category', name: '変数', categorystyle: 'variable_category', custom: 'VARIABLE' },
  ],
}

/**
 * Generate the complete mod.js source from a Blockly workspace.
 */
export function generateModSource(generator, workspace) {
  const body = generator.workspaceToCode(workspace)
  return assembleModSource(body.replace(/\s+$/, ''))
}
