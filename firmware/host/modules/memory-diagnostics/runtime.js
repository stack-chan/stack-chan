import config from 'mc/config'
import { snapshot } from 'memory-diagnostics/heap'
import { createMemoryRecorder } from 'memory-diagnostics/recorder'
import Timer from 'timer'

export const recorder = createMemoryRecorder({
  snapshot,
  write: (line) => trace(line),
  schedule: (callback, delay) => Timer.set(callback, delay),
  cancel: (timer) => Timer.clear(timer),
  runId: config.memoryDiagnostics?.runId ?? 'unlabelled',
})

export function installMemoryControls(robot) {
  let phase = 'idle-unused'
  robot.ui.drawer.addDrawerButton({
    key: 'memory:phase',
    label: 'メモリ測定段階',
    kind: 'choice',
    value: phase,
    options: ['idle-unused', 'duplex', 'post-close'].map((value) => ({ value, label: value })),
    callback: (_robot, value) => {
      phase = value
    },
  })
  robot.ui.drawer.addDrawerButton({
    key: 'memory:snapshot',
    label: 'メモリ記録',
    callback: () => recorder.checkpoint(phase),
  })
  recorder.checkpoint('idle-unused')
}
