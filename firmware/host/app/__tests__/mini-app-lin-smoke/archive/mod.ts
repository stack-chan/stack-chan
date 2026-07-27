import { runMiniAppSmoke } from 'mini-app-smoke-behavior'

const behavior = {
  onLaunch() {
    trace('[MiniApp Lin Smoke] combined archive MOD loaded\n')
    return true
  },
  async onContextCreated(context: Parameters<typeof runMiniAppSmoke>[0]) {
    await runMiniAppSmoke(context)
  },
}

export default behavior
