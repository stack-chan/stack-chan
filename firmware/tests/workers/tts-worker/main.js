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
          trace(`power: ${message.value}, open: ${open}\n`)
          ctx.mouth.open = open
          renderer.update(INTERVAL, ctx)
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
