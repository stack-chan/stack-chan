import Worker from 'worker'
import Timer from 'timer'
import Time from 'time'
import { Renderer } from 'simple-face'
import { defaultFaceContext } from 'renderer-base'
import structuredClone from "structuredClone";

const INTERVAL = 1000 / 30
const renderer = new Renderer({})
const ctx = structuredClone(defaultFaceContext)

let lastRendered = null
Timer.set((id) => {
  const start = Time.ticks
  trace('render')
  renderer.update(INTERVAL, ctx)
  lastRendered = Time.ticks

  const next = lastRendered == null ? INTERVAL : Math.max(INTERVAL - Time.delta(start), 0)
  trace(` -> ${next} \n`)
  Timer.schedule(id, next, 20000)
})

let aWorker = null
function speechLoop () {
  if (aWorker == null) {
    aWorker = new Worker('simpleworker', {
      static: 0,
      stack: 512,
      heap: {
        initial: 16000,
        incremental: 0,
      },
    })
    aWorker.onmessage = function (message) {
      let open
      switch (message.type) {
        case 'onPlayed':
          open = Math.min(message.value / 1500, 1.0)
          trace(`power: ${message.value}, open: ${open}`)
          ctx.mouth.open = open
          if (lastRendered != null && Time.delta(lastRendered) > INTERVAL * 3) {
            trace(' !!render!!')
            renderer.update(INTERVAL, ctx)
            lastRendered = Time.ticks
          }
          trace(`\n`)
          break
        case 'onDone':
          trace(`done\n`)
          ctx.mouth.open = 0
          Timer.set(speechLoop, 5000)
      }
    }
  }
  aWorker.postMessage('Hello. I am Stack-chan. Nice to meet you!')
}

Timer.set(speechLoop, 3000)
