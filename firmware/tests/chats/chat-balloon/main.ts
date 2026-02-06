import { Application, type Content, Skin, Style } from 'piu/MC'
import { SpeechBalloon } from 'effects/speech-balloon'
import { defaultFaceContext, type FaceContext } from 'face-context'
import { assert } from 'mocks/assert'
import Timer from 'timer'

trace('=== chat-balloon test ===\n')

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
app.add(fixedBalloon)
app.add(streamBalloon)

type BalloonBehavior = {
  onDisplaying?: (content: Content) => void
  onFaceContext?: (content: Content, face: FaceContext) => void
  setText?: (content: Content, text: string) => void
  clear?: (content: Content) => void
}

type BalloonContent = {
  behavior?: BalloonBehavior
}

// Force behavior initialization
const fixedBalloonAny = fixedBalloon as unknown as BalloonContent
fixedBalloonAny.behavior?.onDisplaying?.(fixedBalloon)
fixedBalloonAny.behavior?.onFaceContext?.(fixedBalloon, defaultFaceContext)
fixedBalloonAny.behavior?.setText?.(fixedBalloon, '固定表示の Balloon です。')

const streamBalloonAny = streamBalloon as unknown as BalloonContent
streamBalloonAny.behavior?.onDisplaying?.(streamBalloon)
streamBalloonAny.behavior?.onFaceContext?.(streamBalloon, defaultFaceContext)

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

assert(app.length === 2, 'two balloons should be attached')

trace('ok\n')
