import jump from 'jump'
import { runMiniAppSmoke } from 'mini-app-smoke-behavior'
import { definePiuApp } from 'stackchan/extensions/piu'

export default definePiuApp({
  screens: jump,
  async setup() {
    trace('[MiniApp Lin Smoke] SDK archive loaded\n')
    await runMiniAppSmoke(application)
  },
})
