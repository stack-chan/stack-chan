import { Container, Content, Skin } from 'piu/MC'

type ChatState =
  | 'FAILED'
  | 'DISCONNECTED'
  | 'DISCONNECTING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'SPEAKING'
  | 'LISTENING'
  | 'WAITING'

const barHeight = 18
const levelHeight = 16
const levelWidth = 4
const iconSize = 16
const iconLeft = 8
const iconTop = (barHeight - iconSize) / 2
const levelLeft = iconLeft + iconSize + 4

type ChatStatusSkins = {
  bar: Skin
  levelTrack: Skin
  levelFill: Skin
  errorFill: Skin
  microphone: Skin
  indicator: Skin
}

let cachedSkins: ChatStatusSkins | null = null

function getSkins(): ChatStatusSkins {
  if (!cachedSkins) {
    cachedSkins = {
      bar: new Skin({ fill: 'transparent' }),
      levelTrack: new Skin({ fill: '#2c2c2c' }),
      levelFill: new Skin({ fill: '#4caf50' }),
      errorFill: new Skin({ fill: '#ff5252' }),
      microphone: new Skin({
        texture: { path: 'microphone.png' },
        color: ['#ffffff', '#ffffff'],
        x: 0,
        y: 0,
        width: iconSize,
        height: iconSize,
        states: iconSize,
      }),
      indicator: new Skin({
        texture: { path: 'indicator.png' },
        color: ['#ffffff'],
        x: 0,
        y: 0,
        width: iconSize,
        height: iconSize,
        variants: iconSize,
      }),
    }
  }
  return cachedSkins
}

class IndicatorBehavior extends Behavior {
  #frame = 0

  onDisplaying(content: Content) {
    content.variant = 0
  }

  onTimeChanged(content: Content) {
    this.#frame = (this.#frame + 1) % 4
    content.variant = this.#frame
  }
}

class ChatStatusBarBehavior extends Behavior {
  #state: ChatState = 'DISCONNECTED'
  #inputLevel = 0
  #levelTrack?: Container
  #levelFill?: Content
  #statusIcon?: Content
  #indicator?: Content

  onCreate(container: Container) {
    this.#statusIcon = container.content('statusIcon') as Content
    this.#indicator = container.content('statusIndicator') as Content
    this.#levelTrack = container.content('levelTrack') as Container
    this.#levelFill = this.#levelTrack?.first as Content
    this.updateUI()
  }

  onChatState(_container: Container, state: ChatState, _error?: string) {
    this.#state = state
    this.updateUI()
  }

  onChatInputLevel(_container: Container, level: number) {
    this.#inputLevel = level
    this.updateLevel()
  }

  updateUI() {
    if (!this.#levelTrack || !this.#levelFill || !this.#statusIcon || !this.#indicator) return
    const isListening = this.#state === 'SPEAKING'
    const isSpeaking = this.#state === 'LISTENING'
    const isConnecting = this.#state === 'CONNECTING'
    this.#levelTrack.visible = isListening
    this.#statusIcon.visible = isListening || isSpeaking
    this.#statusIcon.state = isSpeaking ? 1 : 0
    this.#indicator.visible = isConnecting
    if (isConnecting) {
      this.#indicator.interval = 250
      this.#indicator.time = 0
      this.#indicator.start()
    } else {
      this.#indicator.stop()
      this.#indicator.variant = 0
    }
    const skins = getSkins()
    this.#levelFill.skin = this.#state === 'FAILED' ? skins.errorFill : skins.levelFill
    this.updateLevel()
  }

  updateLevel() {
    if (!this.#levelTrack || !this.#levelFill) return
    const ratio = Math.min(Math.max(this.#inputLevel / 2000, 0), 1)
    const height = Math.round(levelHeight * ratio)
    this.#levelFill.height = height
  }
}

export const ChatStatusBar = Container.template(() => {
  const skins = getSkins()
  return {
    name: 'ChatStatusBar',
    anchor: 'APP_BAR',
    left: 0,
    right: 0,
    top: 0,
    height: barHeight,
    skin: skins.bar,
    contents: [
      new Content(null, {
        name: 'statusIcon',
        left: iconLeft,
        top: iconTop,
        width: iconSize,
        height: iconSize,
        skin: skins.microphone,
        state: 0,
        visible: false,
      }),
      new Content(null, {
        name: 'statusIndicator',
        left: iconLeft,
        top: iconTop,
        width: iconSize,
        height: iconSize,
        skin: skins.indicator,
        variant: 0,
        active: true,
        visible: false,
        Behavior: IndicatorBehavior,
      }),
      new Container(null, {
        name: 'levelTrack',
        left: levelLeft,
        top: iconTop,
        width: levelWidth,
        height: levelHeight,
        skin: skins.levelTrack,
        contents: [
          new Content(null, {
            left: 0,
            bottom: 0,
            width: levelWidth,
            height: 0,
            skin: skins.levelFill,
          }),
        ],
      }),
    ],
    Behavior: ChatStatusBarBehavior,
  }
})
