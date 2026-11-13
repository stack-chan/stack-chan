import { Content } from 'piu/MC'

export const FaceObserver = Content.template((renderer) => ({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  active: false,
  Behavior: class extends Behavior {
    onDisplaying() {
      renderer.restore()
    }
    onFaceState(_content, state) {
      renderer.capture(state)
    }
  },
}))
