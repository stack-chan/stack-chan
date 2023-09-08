import  {Renderer}  from 'simple-face'
import Timer from 'timer'

const INTERVAL = 1000 / 30
const renderer = new Renderer({})
Timer.repeat(() => {
  renderer.update(INTERVAL)
}, INTERVAL)
