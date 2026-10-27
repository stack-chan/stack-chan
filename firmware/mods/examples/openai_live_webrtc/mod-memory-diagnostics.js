import { installMemoryControls } from 'memory-diagnostics/runtime'
import { onContextCreated as launchLive } from 'openai-live-mod/base'

export function onContextCreated(robot) {
  // Capture before the original MOD lazily imports realtimeConversation.
  installMemoryControls(robot)
  return launchLive(robot)
}
