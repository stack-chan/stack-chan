import Worker from 'worker'
import Timer from 'timer'
import { Renderer } from 'simple-face'
import { defaultFaceContext } from 'renderer-base'
import structuredClone from "structuredClone";

const INTERVAL = 1000 / 30
const renderer = new Renderer({})
const ctx = structuredClone(defaultFaceContext)

Timer.repeat(() => {
  renderer.update(INTERVAL, ctx)
}, INTERVAL)

let aWorker = null
function start() {
  if (aWorker == null) {
    aWorker = new Worker('simpleworker', {
      static: 0,
      stack: 256,
      heap: {
        initial: 640,
        incremental: 0,
      },
    })
    aWorker.onmessage = function (message) {
      switch (message.type) {
        case 'onPlayed':
          trace(`power: ${message.value}\n`)
          ctx.mouth.open = Math.min(message.value / 2000, 1.0)
          break
        case 'onDone':
          trace(`done\n`)
          Timer.set(start, 5000)
      }
    }
  }
  aWorker.postMessage('')
}

start()
