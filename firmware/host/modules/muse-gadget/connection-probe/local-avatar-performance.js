import { createGuruguruView } from 'guruguru-view'
import { Application } from 'piu/MC'
import { openOutput } from 'stackchan/voice/cores3-pcm-output'
import Resource from 'Resource'
import Timer from 'timer'
import Time from 'time'

const view = createGuruguruView()
new Application(null, { contents: [view.content], displayListLength: 8192 })
Timer.set(async () => {
  let output
  try {
    const pcm = new Uint8Array(new Resource('synthetic-performance.pcm'))
    output = openOutput(16000, 0.25, 6400)
    view.model.setState('speak')
    const started = Time.ticks
    let maxWriteMs = 0
    for (let offset = 0; offset < pcm.length; offset += 1280) {
      const before = Time.ticks
      await output.write(pcm.subarray(offset, offset + 1280))
      maxWriteMs = Math.max(maxWriteMs, (Time.ticks - before) >>> 0)
    }
    await output.drain()
    trace(`MUSE_TIMING local_audio_ms ${(Time.ticks - started) >>> 0}\n`)
    trace(`MUSE_TIMING local_frames ${output.frames}\n`)
    trace(`MUSE_TIMING max_write_ms ${maxWriteMs}\n`)
    trace('MUSE_CONNECT note_local_avatar_pass\n')
  } catch (_) {
    trace('MUSE_CONNECT note_local_avatar_failed\n')
  } finally {
    view.model.setState('idle')
    output?.close()
    trace('MUSE_PROBE closed\n')
  }
}, 1000)
