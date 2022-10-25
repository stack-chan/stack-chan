import  {Renderer}  from 'face-renderer'
import Timer from 'timer'

const renderer = new Renderer
Timer.repeat(() => {
  renderer.update()
}, 16)
