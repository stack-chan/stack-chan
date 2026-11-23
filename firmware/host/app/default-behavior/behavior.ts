import type { StackchanAppBehavior } from 'app-behavior'
import { onContextCreated } from 'app-default-behavior/on-context-created'
import { onLaunch } from 'app-default-behavior/on-launch'
import type { StackchanContext } from 'capabilities'
import Modules from 'modules'

let closeMuse: (() => Promise<void>) | undefined

const behavior: StackchanAppBehavior = {
  onLaunch,
  async onContextCreated(context, options) {
    await onContextCreated(context, options)
    if (Modules.has('app-default-behavior/muse-conversation-ui')) {
      const { installMuseConversationUI } = Modules.importNow('app-default-behavior/muse-conversation-ui', true) as {
        installMuseConversationUI(robot: StackchanContext): (() => Promise<void>) | undefined
      }
      closeMuse = installMuseConversationUI(context)
    }
  },
  onClose() {
    const close = closeMuse
    closeMuse = undefined
    return close?.()
  },
}

export default behavior
