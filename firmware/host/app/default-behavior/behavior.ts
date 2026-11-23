import type { StackchanAppBehavior } from 'app-behavior'
import { installMuseConversationUI } from 'app-default-behavior/muse-conversation-ui'
import { onContextCreated } from 'app-default-behavior/on-context-created'
import { onLaunch } from 'app-default-behavior/on-launch'

let closeMuse: (() => Promise<void>) | undefined

const behavior: StackchanAppBehavior = {
  onLaunch,
  async onContextCreated(context, options) {
    await onContextCreated(context, options)
    closeMuse = installMuseConversationUI(context)
  },
  onClose() {
    const close = closeMuse
    closeMuse = undefined
    return close?.()
  },
}

export default behavior
