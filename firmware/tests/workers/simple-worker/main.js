import Worker from 'worker'
import Timer from 'timer'

let index = 0

function post() {
  let aWorker = new Worker('simpleworker', {
    static: 0,
    stack: 64,
    heap: {
      initial: 640,
      incremental: 0,
    },
  })

  aWorker.onmessage = function (message) {
      trace(`${JSON.stringify(message)}\n`)
  }

  Timer.repeat(() => {
    aWorker.postMessage({ index: ++index })
  }, 50)
}

post()
