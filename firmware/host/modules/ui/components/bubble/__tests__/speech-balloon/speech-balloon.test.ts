import { SpeechBalloon, type SpeechBalloonTail } from 'effects/speech-balloon'
import { createFaceState, type FaceState, setColorRGB } from 'face-state'
import { Application, type Content, Skin, Style } from 'piu/MC'
import createUsbAudioPresentation from 'stackchan-usb-dock-presentation'
import { assert } from 'testing/assert'
import Timer from 'timer'

trace('=== chat-balloon test ===\n')

assert(
  typeof createUsbAudioPresentation === 'function',
  'the lazily imported USB Dock presentation should expose a callable module default',
)

const app = new Application(null, {
  displayListLength: 8192,
  contents: [],
  skin: new Skin({ fill: 'black' }),
  style: new Style({ font: 'k8x12-12', color: '#ffffff', horizontal: 'left', vertical: 'middle' }),
})
const fixedBalloon = new SpeechBalloon({
  top: 8,
  left: 8,
  right: 8,
  text: '固定表示の Balloon です。',
  font: 'k8x12-12',
}) as unknown as Content
const streamBalloon = new SpeechBalloon({
  left: 8,
  right: 8,
  bottom: 8,
  text: '',
  font: 'k8x12-12',
}) as unknown as Content
const lookBalloon = new SpeechBalloon({
  right: 20,
  top: 10,
  width: 80,
  text: 'looking',
  font: 'k8x12-12',
}) as unknown as Content
const defaultBalloon = new SpeechBalloon({
  text: '1行目\n2行目',
}) as unknown as Content
app.add(fixedBalloon)
app.add(streamBalloon)
app.add(lookBalloon)
app.add(defaultBalloon)

type BalloonBehavior = {
  onDisplaying?: (content: Content) => void
  onFaceState?: (content: Content, face: FaceState) => void
  setText?: (content: Content, text: string) => void
  clear?: (content: Content) => void
}

type BalloonContent = {
  first?: BalloonNode | null
  behavior?: BalloonBehavior
}

type BalloonNode = Content & {
  next?: BalloonNode | null
  skin?: unknown
  style?: unknown
  string?: string
}

type BalloonLayout = Content & {
  coordinates?: {
    left?: number
    right?: number
    top?: number
    bottom?: number
    height?: number
  }
}

function measuredHeight(content: BalloonLayout): number {
  return content.coordinates?.height ?? content.height
}

// Force behavior initialization
const fixedBalloonAny = fixedBalloon as unknown as BalloonContent
const defaultFace = createFaceState()
fixedBalloonAny.behavior?.onDisplaying?.(fixedBalloon)
fixedBalloonAny.behavior?.onFaceState?.(fixedBalloon, defaultFace)
fixedBalloonAny.behavior?.setText?.(fixedBalloon, '固定表示の Balloon です。')
const fixedBackgroundSkin = fixedBalloonAny.first?.skin

const streamBalloonAny = streamBalloon as unknown as BalloonContent
streamBalloonAny.behavior?.onDisplaying?.(streamBalloon)
streamBalloonAny.behavior?.onFaceState?.(streamBalloon, defaultFace)
const defaultBackground = streamBalloonAny.first as BalloonNode
const defaultText = defaultBackground.next as BalloonNode
const defaultBackgroundSkin = defaultBackground.skin
const defaultTextStyle = defaultText.style
assert(
  fixedBackgroundSkin !== defaultBackgroundSkin,
  'top and bottom placement should automatically select different tail directions',
)

const defaultBalloonAny = defaultBalloon as unknown as BalloonContent
defaultBalloonAny.behavior?.onDisplaying?.(defaultBalloon)
defaultBalloonAny.behavior?.onFaceState?.(defaultBalloon, defaultFace)
const defaultLayout = defaultBalloon as BalloonLayout
assert(defaultLayout.coordinates?.left === 16, 'default balloon should keep a 16px left margin')
assert(defaultLayout.coordinates?.right === 16, 'default balloon should keep a 16px right margin')
assert(defaultLayout.coordinates?.bottom === 12, 'default balloon should keep a 12px bottom margin')
assert(defaultLayout.coordinates?.top === undefined, 'default balloon should be anchored to the bottom')
assert(measuredHeight(defaultLayout) === 44, 'default balloon should fit two k8x12 lines in 44px')

const tails: SpeechBalloonTail[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const tailSkins = tails.map((tail) => {
  const balloon = new SpeechBalloon({ tail, text: tail }) as unknown as Content
  const balloonAny = balloon as unknown as BalloonContent
  balloonAny.behavior?.onDisplaying?.(balloon)
  balloonAny.behavior?.onFaceState?.(balloon, defaultFace)
  return balloonAny.first?.skin
})
for (let i = 0; i < tailSkins.length; i += 1) {
  assert(tailSkins[i] != null, `${tails[i]} should initialize a bubble skin`)
  for (let j = i + 1; j < tailSkins.length; j += 1) {
    assert(tailSkins[i] !== tailSkins[j], `${tails[i]} and ${tails[j]} should use different texture regions`)
  }
}

const themedFace = createFaceState()
setColorRGB(themedFace.theme.primary, 0x12, 0x34, 0x56)
setColorRGB(themedFace.theme.secondary, 0xab, 0xcd, 0xef)
streamBalloonAny.behavior?.onFaceState?.(streamBalloon, themedFace)

const themedBackground = streamBalloonAny.first as BalloonNode
const themedText = themedBackground.next as BalloonNode
assert(themedBackground.skin !== defaultBackgroundSkin, 'balloon should update bubble skin for themed colors')
assert(themedText.style !== defaultTextStyle, 'balloon should update text style for themed colors')

streamBalloonAny.behavior?.setText?.(streamBalloon, 'stream update')
assert(themedText.string === 'stream update', 'setText should update balloon text')
streamBalloonAny.behavior?.clear?.(streamBalloon)
assert(themedText.string === '', 'clear should empty balloon text')

const lookBalloonAny = lookBalloon as unknown as BalloonContent
lookBalloonAny.behavior?.onDisplaying?.(lookBalloon)
lookBalloonAny.behavior?.onFaceState?.(lookBalloon, defaultFace)
assert(
  measuredHeight(lookBalloon as BalloonLayout) >= 44,
  'short top-positioned balloon should keep enough height for texture caps',
)

const chunks = [
  'このテキストは SpeechBalloon の',
  ' 自動折り返しと高さ伸長の',
  ' 挙動を確認するために',
  ' 250ms ごとに追記されます。',
  '\n次の段落も追加します。',
  ' さらに長くして二行以上にします。',
]
let textToShow = ''
let nextChunkIndex = 0

Timer.repeat(() => {
  const chunk = chunks[nextChunkIndex]
  nextChunkIndex = (nextChunkIndex + 1) % chunks.length
  textToShow += chunk
  streamBalloonAny.behavior?.setText?.(streamBalloon, textToShow)
}, 250)

Timer.repeat(() => {
  textToShow = ''
  if (streamBalloonAny.behavior?.clear) streamBalloonAny.behavior.clear(streamBalloon)
  else streamBalloonAny.behavior?.setText?.(streamBalloon, '')
}, 5000)

assert(app.length === 4, 'four balloons should be attached')

trace('ok\n')
