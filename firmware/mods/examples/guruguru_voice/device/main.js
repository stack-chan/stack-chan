import { createGuruguruView } from 'guruguru-view'
import { Application } from 'piu/MC'
import Timer from 'timer'

const view = createGuruguruView()
globalThis.application = new Application(null, { contents: [view.content], displayListLength: 4096, touchCount: 1 })
trace('GURUGURU: Piu ready; touch nine regions\n')
let step = 0
const states = ['idle', 'listen', 'think', 'speak']
Timer.repeat(() => {
  view.model.setState(states[step++ % states.length])
  trace(`GURUGURU: state=${view.model.state}\n`)
}, 3000)
Timer.repeat(() => {
  if (view.model.state === 'speak') view.model.setLevel((Date.now() % 600) / 2400)
}, 100)
