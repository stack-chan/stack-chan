import snapshot from 'memory-diagnostics'
import { MemoryRecorder } from 'memory-recorder'

// Idle-only baseline also works before #757: no realtimeConversation import.
export function onContextCreated(robot) {
  const recorder = new MemoryRecorder({ snapshot, write: (line) => trace(line) })
  robot.ui.drawer.addDrawerButton({
    key: 'memory:idle',
    label: 'メモリ測定',
    callback: () => recorder.sample('idle-before-use'),
  })
}
