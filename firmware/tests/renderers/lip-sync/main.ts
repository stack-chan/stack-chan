import { Renderer } from 'simple-face'
import Timer from 'timer'
import { TTS } from 'tts-local'

const INTERVAL = 1000 / 30
const renderer = new Renderer({})

let open = 0.0
renderer.filters.push((interval, ctx) => {
  ctx.mouth.open = open
  return ctx
})

const tts = new TTS({
  onPlayed: (num) => {
    trace(`played ${num}\n`)
    open = Math.min(num / 2000, 1.0)
  },
  onDone: () => {
    trace('done\n')
    open = 0
  },
})

Timer.repeat(() => {
  renderer.update(INTERVAL)
}, INTERVAL)

globalThis.button.a.onChanged = async function () {
  if (this.read()) {
    await tts.stream('wilhelm-scream').catch((e) => {
      trace(e)
    })
  }
} 
