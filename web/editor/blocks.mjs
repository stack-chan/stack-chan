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
    message0: 'ボタン %1 が押されたとき %2 %3',
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
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    colour: BLOCK_STYLE.event,
    tooltip: '本体のボタンが押されたときに実行します',
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
    const body = asyncHandlerBody(gen, block)
    return (
      `if (robot.input.button?.${button}) {\n` +
      `  robot.input.button.${button}.onEvent = (event) => {\n` +
      `    if (!event.pressed) return\n` +
      `    void (async () => {\n${body.replace(/^/gm, '    ')}\n` +
      `    })().catch((error) => trace('button ${button} handler failed: ' + error + '\\n'))\n` +
      `  }\n` +
      `}\n`
    )
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
