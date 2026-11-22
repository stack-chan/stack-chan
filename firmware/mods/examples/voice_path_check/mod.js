import Modules from 'modules'
import Timer from 'timer'
import { PathCheck } from 'voice-path-controller'
import { createRoute } from 'voice-path-routes'

let check
export function onContextCreated(robot) {
  const settings = (Modules.has('mod/config') ? Modules.importNow('mod/config').voicePathCheck : undefined) ?? {}
  const { ConversationPipeline } = Modules.importNow('stackchan/voice', true)
  check = new PathCheck({
    createRoute: () => createRoute(settings, (name) => Modules.importNow(name, true)),
    createPipeline: (conversation, onEvent) => {
      if (!robot.audio.microphone || !robot.audio.speaker) throw new Error('Audio unavailable')
      const pipeline = ConversationPipeline.create({
        conversation,
        microphone: robot.audio.microphone,
        speaker: robot.audio.speaker,
        onEvent,
        mediaBudget: { maxBufferedBytes: 128 * 1024, maxBufferedMs: 2000 },
      })
      pipeline.setVolume(settings.volume ?? 0.25)
      return pipeline
    },
    networkReady: robot.connectivity.network?.ready,
    schedule: (fn, ms) => Timer.set(fn, ms),
    clear: (id) => Timer.clear(id),
    maxMs: settings.maxMs,
    notify: (state) => {
      try {
        robot.ui.showBalloon(`Audio test: ${state}`)
      } catch {}
      trace(`[voice-path] ${state}\n`)
    },
  })
  for (const [label, callback] of [
    [
      'Start test',
      () => {
        void check.start()
      },
    ],
    [
      'Stop test',
      () => {
        void check.stop()
      },
    ],
    ['Record / Send', () => check.record()],
  ])
    robot.ui.drawer.addDrawerButton({ key: `voice-path:${label}`, label, callback })
}
export function onClose() {
  return check?.stop()
}
