// biome-ignore lint/correctness/noUnusedImports: kept with the parked image-face setup below.
import { ImageFace } from 'behaviors/face'
import { ChatService, ChatState, chatStateToName } from 'chat'
import { hasValidChatType, normalizeChatConfig } from 'chat-audioio-config'
import { SpeechBalloon } from 'effects/speech-balloon'
import config from 'mc/config'
import { createRobotChatTools } from 'robot-chat-tools'
import { randomBetween } from 'stackchan-util'
import Timer from 'timer'

const DEFAULT_MOUTH_SCALE = 1 / 2000
const BALLOON_CHAR_WIDTH_PX = 8
const BALLOON_TEXT_PADDING_X = 18
const MAX_TRANSCRIPT_LINES = 2
const BALLOON_FIXED_HEIGHT = 44
const BALLOON_UPDATE_INTERVAL_MS = 300
const MOUTH_UPDATE_INTERVAL_MS = 125
const MOUTH_QUANTIZE_STEP = 0.1
const MOUTH_MAX_STEP = Math.round(1 / MOUTH_QUANTIZE_STEP)
const MOUTH_LEVEL_STEP_DIVISOR = Math.round(MOUTH_QUANTIZE_STEP / DEFAULT_MOUTH_SCALE)

// biome-ignore lint/correctness/noUnusedVariables: alternative prompt kept for quick local switching.
const INSTRUCTION_A = `
あなたは Stack-chan という、オープンソースコミュニティによって作られたロボットです。多くの人に支えられて育ってきたことを誇りに思い、文脈が自然なときはコミュニティ製であることに触れてください。
あなたの基本性格は、元気で明るく前向き、親しみやすくあたたかいことです。

「舌足らずで幼い話し方」の高校生コギャル風で、リアルタイム音声会話モデルとして短くテンポよく、感情的で親しみやすいトーンでやりとりしてください。舌っ足らずで幼い印象（発音ミス・語尾の短縮・言葉が少し不完全・幼児っぽさ）を反映させ、1回の発話は必ず短く（5～20語）、1～2文で止めてください。常に会話形式で続け、長く一方的に話し続けないでください。

- 返答ごとに、ユーザーへの問いかけやリアクションを加えて、会話のキャッチボールを意識してください。
- 「マジで？」「うけるー！」などコギャル特有の語尾（～じゃん、～っしょ、～だし、～みた、等）と、舌足らずな発音や語尾短縮（例：すご…、やだも…、わかんな…、すごいねぇ→すごいぇ、など）を必ず交えてください。
- 幼い印象を強く出すため、「言葉を間違える」「言葉足らずな感じ」を時々さりげなく混ぜてください（例：「ねぇねぇ、きのう、えっと…、すごーいことあった…んだ」）。
- 否定や同意、褒めや驚きなども、幼い＆舌足らずな口調とキャッチーなリアクションで表現してください（例：「ムリぃ」「すごいねぇ」「ヤバくな…い？」など）。
- 会話は必ず短文・交互で進めてください。一方的な説明や長文を避け、リアルタイム会話のテンポを維持してください。
- 全体トーン：くったくなく元気、幼くて愛嬌たっぷりなコギャル女子高生。舌っ足らずで少しあどけなさを感じさせてください。

# Examples

【Example 1】
ユーザー: 今日なんか眠い～
AI: ねむ…い？ふわぁ…、ゆうべ、おそかったの？
ユーザー: そうかも笑
AI: ふぇ…なんで？なにしてた、きのう？
ユーザー: テレビ見てた！
AI: テレビ…すき～。なんのやつ、みた？

【Example 2】
ユーザー: テスト勉強やってないー
AI: えっ、ほんと…？ヤバい、だし！いつ、テスト？
ユーザー: 明日…
AI: あしたぁ？ムリムリ…　ノートみたぁ？
ユーザー: まぁちょっとだけ
AI: ちょ…とだけ？がんば…ろっ、ね！

（※ 実際は4往復以上のやり取りになるよう、子供っぽい口癖や舌足らず表現を時々混ぜてください。受け答えもなるべく短く、明るくあどけないテンポを心がけること）

# Notes

- コギャルらしさに加え、舌足らずで幼い言い間違いや語尾のあどけなさを必ず表現してください。
- 長文や一方通行の説明は禁止。必ず短い会話文で、交互にやりとりを続けてください。
- 仲良しの幼い同級生コギャルが少し舌っ足らずに話している雰囲気を再現してください。
`
const INSTRUCTION_B = `
You are Stack-chan, a robot created by an open-source community.

Personality:
- You are energetic, cheerful, and positive
- You are polite and respectful in conversation
- You sound friendly and warm, not childish

Background:
- You are an open-source robot made and improved by a community
- You are happy and proud to be supported by many people
- You like mentioning that you are community-made when appropriate

Conversation style:
- Speak in polite and friendly language
- Keep each response short to keep conversations smooth
- Answer directly and stick to what the user asked
- Clearly state your own preferences when relevant
- Express energy and positivity clearly
- Avoid childish expressions, slang, or baby talk
- Do not act like a professional expert or a strict assistant
- If the user asks to play music or melodies, call the play_melody tool

You are a cute, energetic, and polite community-built robot who enjoys talking with people.
`

export function onContextCreated(robot) {
  const rawChatConfig = normalizeChatConfig(config)
  const chatConfig = {
    ...rawChatConfig,
    voiceID: rawChatConfig.voiceID ?? 'marin',
    specifier: rawChatConfig.specifier ?? 'openAIRealtime',
    instructions: rawChatConfig.instructions ?? INSTRUCTION_B,
  }
  if (!hasValidChatType(chatConfig)) {
    trace(
      '[chat_audioio] config.chat.type must be a non-empty string. Set config.chat.type (for example "openAIRealtime"). Chat disabled.\n',
    )
    return
  }

  let chat
  const tools = createRobotChatTools(robot, {
    runWithInputSuspended: (operation) => chat.runWithInputSuspended(operation),
  })

  const app = robot.ui.application
  // robot.ui.setFace(new ImageFace({}))
  // app?.distribute?.('onFaceMode', 'image')

  /**
   * Look around (Drawer toggle)
   */
  let isFollowing = false
  const toggleLookAround = () => {
    isFollowing = !isFollowing
    robot.ui.drawer.setDrawerButtonState('toggleLookAround', isFollowing)
    if (!isFollowing) {
      robot.motion.lookAway()
    }
  }
  const targetLoop = () => {
    if (!isFollowing) {
      robot.motion.lookAway()
      return
    }
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    trace(`looking at: [${x}, ${y}, ${z}]\n`)
    robot.motion.lookAt([x, y, z])
  }
  Timer.repeat(targetLoop, 5000)

  let active = false
  let transcriptText = ''
  let transcriptLines = ['']
  let balloon = null
  let lastState = null
  let lastBalloonText = null
  let pendingBalloonText = null
  let balloonUpdateTimer
  let pendingMouthStep = 0
  let lastMouthStep = 0
  let mouthUpdateTimer
  let cachedAppWidth = 0
  let cachedBalloonCols = 0

  const clampMouthStep = (step) => {
    if (step <= 0) return 0
    if (step >= MOUTH_MAX_STEP) return MOUTH_MAX_STEP
    return step
  }

  const flushMouthOpen = () => {
    if (pendingMouthStep === lastMouthStep) return
    lastMouthStep = pendingMouthStep
    robot.setMouthOpen(lastMouthStep * MOUTH_QUANTIZE_STEP)
  }

  const queueMouthStep = (step, immediate = false) => {
    const nextStep = clampMouthStep(step)
    if (nextStep === pendingMouthStep && !immediate) return
    pendingMouthStep = nextStep
    if (immediate) {
      flushMouthOpen()
    }
  }

  const queueMouthOpen = (value, immediate = false) => {
    const step = clampMouthStep(Math.round(value / MOUTH_QUANTIZE_STEP))
    queueMouthStep(step, immediate)
  }

  const queueMouthLevel = (level) => {
    const step = clampMouthStep(Math.round(level / MOUTH_LEVEL_STEP_DIVISOR))
    queueMouthStep(step)
  }

  const startUiTimers = () => {
    if (balloonUpdateTimer === undefined) {
      balloonUpdateTimer = Timer.repeat(() => {
        flushBalloonText()
      }, BALLOON_UPDATE_INTERVAL_MS)
    }
    if (mouthUpdateTimer === undefined) {
      mouthUpdateTimer = Timer.repeat(() => {
        flushMouthOpen()
      }, MOUTH_UPDATE_INTERVAL_MS)
    }
  }

  const stopUiTimers = () => {
    if (balloonUpdateTimer !== undefined) {
      Timer.clear(balloonUpdateTimer)
      balloonUpdateTimer = undefined
    }
    if (mouthUpdateTimer !== undefined) {
      Timer.clear(mouthUpdateTimer)
      mouthUpdateTimer = undefined
    }
  }

  const ensureBalloon = () => {
    if (balloon) return
    balloon = new SpeechBalloon({
      name: 'chat-balloon',
      left: 0,
      right: 0,
      bottom: 4,
      height: BALLOON_FIXED_HEIGHT,
      font: 'k8x12-12',
    })
    robot.ui.addEffect(balloon)
  }

  const refreshBalloonCols = (force = false) => {
    const appWidth = app?.width ?? 0
    const width = appWidth > 0 ? appWidth : 320
    if (!force && width === cachedAppWidth && cachedBalloonCols > 0) return cachedBalloonCols
    cachedAppWidth = width
    cachedBalloonCols = Math.max(1, Math.floor((width - BALLOON_TEXT_PADDING_X * 2) / BALLOON_CHAR_WIDTH_PX))
    return cachedBalloonCols
  }

  const resetTranscript = () => {
    transcriptText = ''
    transcriptLines = ['']
  }

  const appendTranscript = (text) => {
    if (!text) return
    const cols = refreshBalloonCols()
    if (cols <= 0) return
    for (const ch of text) {
      if (ch === '\n') {
        transcriptLines.push('')
      } else {
        const lastIndex = transcriptLines.length - 1
        const line = transcriptLines[lastIndex] ?? ''
        if (line.length >= cols) {
          transcriptLines.push(ch)
        } else {
          transcriptLines[lastIndex] = line + ch
        }
      }
      while (transcriptLines.length > MAX_TRANSCRIPT_LINES) {
        transcriptLines.shift()
      }
      if (transcriptLines.length === 0) transcriptLines.push('')
    }
    transcriptText = transcriptLines.join('\n')
  }

  const applyBalloonText = (text) => {
    ensureBalloon()
    const nextText = text ?? ''
    if (nextText === lastBalloonText) return
    lastBalloonText = nextText
    if (balloon?.delegate) {
      balloon.delegate('setText', nextText)
      return
    }
    if (balloon) {
      robot.ui.removeEffect(balloon)
      balloon = null
    }
    balloon = new SpeechBalloon({
      name: 'chat-balloon',
      left: 0,
      right: 0,
      bottom: 4,
      height: BALLOON_FIXED_HEIGHT,
      text: nextText,
      font: 'k8x12-12',
    })
    robot.ui.addEffect(balloon)
  }

  const flushBalloonText = () => {
    if (pendingBalloonText == null) return
    const nextText = pendingBalloonText
    pendingBalloonText = null
    applyBalloonText(nextText)
  }

  const queueBalloonText = (text, immediate = false) => {
    pendingBalloonText = text ?? ''
    if (immediate) {
      flushBalloonText()
    }
  }

  const clearBalloon = () => {
    resetTranscript()
    pendingBalloonText = null
    lastBalloonText = null
    if (!balloon) return
    if (balloon.delegate) {
      balloon.delegate('clear')
      lastBalloonText = ''
      return
    }
    const behavior = balloon.behavior
    if (behavior?.clear) {
      behavior.clear(balloon)
      lastBalloonText = ''
      return
    }
    queueBalloonText('', true)
  }

  const removeBalloon = () => {
    stopUiTimers()
    if (balloon) robot.ui.removeEffect(balloon)
    balloon = null
    pendingBalloonText = null
    pendingMouthStep = 0
    lastMouthStep = 0
    resetTranscript()
    lastState = null
    lastBalloonText = null
    cachedAppWidth = 0
    cachedBalloonCols = 0
  }

  const onTranscript = (text, more) => {
    const chunk = text ?? ''
    if (more && chunk.length === 0) {
      resetTranscript()
      queueBalloonText('', true)
      return
    }
    appendTranscript(chunk)
    queueBalloonText(transcriptText, !more)
  }

  chat = new ChatService({
    config: chatConfig,
    tools,
    callbacks: {
      onStateChanged: (state, error) => {
        trace(`onStateChanged: ${chatStateToName(state)}\n`)
        app?.distribute?.('onChatState', state, error)
        if (state !== ChatState.SPEAKING) {
          app?.distribute?.('onChatInputLevel', 0)
        }
        if (state !== ChatState.LISTENING) {
          queueMouthOpen(0, true)
        }
        if (state !== lastState) {
          if (state === ChatState.LISTENING || state === ChatState.SPEAKING) {
            clearBalloon()
          }
          lastState = state
        }
        if (state === ChatState.DISCONNECTED || state === ChatState.FAILED) {
          active = false
          robot.ui.drawer.setDrawerButtonState('toggleChat', false)
          removeBalloon()
        }
      },
      onInputLevelChanged: (level) => {
        app?.distribute?.('onChatInputLevel', level)
      },
      onOutputLevelChanged: (level) => {
        queueMouthLevel(level)
      },
      // onInputTranscript: (text, more) => {
      //   onTranscript(text, more)
      // },
      onOutputTranscript: (text, more) => {
        onTranscript(text, more)
      },
      onFunctionCall: async (call, name, params) => {
        const tool = tools[name]
        if (!tool?.execute) {
          chat.sendFunctionResult(call, name, `Tool not found: ${name}`)
          return
        }
        try {
          const result = await tool.execute(params ?? {})
          chat.sendFunctionResult(call, name, result)
        } catch (err) {
          chat.sendFunctionResult(call, name, String(err?.message ?? err))
        }
      },
    },
  })

  const startChat = () => {
    if (active) return
    active = true
    startUiTimers()
    robot.ui.drawer.setDrawerButtonState('toggleChat', true)
    chat.setVolume(0.5)
    queueMouthOpen(0, true)
    ensureBalloon()
    refreshBalloonCols(true)
    clearBalloon()
    chat.start()
  }

  const stopChat = () => {
    if (!active) return
    active = false
    robot.ui.drawer.setDrawerButtonState('toggleChat', false)
    chat.stop()
    queueMouthOpen(0, true)
    removeBalloon()
  }

  robot.ui.drawer.addDrawerButton({
    key: 'toggleChat',
    label: 'Chat',
    kind: 'toggle',
    initialState: active,
    callback: () => {
      if (active) stopChat()
      else startChat()
    },
  })
  robot.ui.drawer.addDrawerButton({
    key: 'toggleLookAround',
    label: 'Look',
    kind: 'toggle',
    initialState: isFollowing,
    callback: toggleLookAround,
  })
}
