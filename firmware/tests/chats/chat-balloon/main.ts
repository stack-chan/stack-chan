import { Application, type Content, Skin, Style } from 'piu/MC'
import { SpeechBalloon } from 'effects/speech-balloon'
import { defaultFaceContext } from 'face-context'
import { assert, equal } from 'mocks/assert'

trace('=== chat-balloon test ===\n')

const app = new Application(null, {
  contents: [],
  skin: new Skin({ fill: 'black' }),
  style: new Style({ font: '16px Open Sans', color: '#ffffff', horizontal: 'left', vertical: 'middle' }),
})
const balloon = new SpeechBalloon({ text: 'hello' }) as unknown as Content
app.add(balloon)

// Force behavior initialization
const balloonAny = balloon as unknown as { behavior?: any; last?: any }
balloonAny.behavior?.onDisplaying?.(balloon)
balloonAny.behavior?.onFaceContext?.(balloon, defaultFaceContext)

const label = balloonAny.last as { string: string }
equal(label.string, 'hello', 'balloon text should match')

// Update with new instance to simulate swap behavior
app.remove(balloon)
const balloon2 = new SpeechBalloon({ text: 'world' }) as unknown as Content
app.add(balloon2)
const balloon2Any = balloon2 as unknown as { behavior?: any; last?: any }
balloon2Any.behavior?.onDisplaying?.(balloon2)
balloon2Any.behavior?.onFaceContext?.(balloon2, defaultFaceContext)
const label2 = balloon2Any.last as { string: string }
equal(label2.string, 'world', 'balloon text should update')

assert(app.length === 1, 'balloon should be attached')

trace('ok\n')
