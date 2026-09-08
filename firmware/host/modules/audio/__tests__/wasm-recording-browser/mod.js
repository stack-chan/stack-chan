// Integration fixture for the private XS/C/browser boundary, not a public SDK lesson.

import Microphone from 'microphone'
import Speaker from 'speaker'
import { defineApp } from 'stackchan'
import { input } from 'stackchan/extensions/input'
import Timer from 'timer'

const report = (message) => trace(`[recording-test] ${message}\n`)
export default defineApp({
  async setup(app) {
    const inputs = new Set()
    const microphone = new Microphone()
    inputs.add(microphone)
    const speaker = new Speaker()
    let recorded
    for (let cycle = 0; cycle < 3; cycle++) {
      const buffer = await microphone.record(300)
      recorded = buffer
      let sum = 0
      for (const byte of new Uint8Array(buffer)) sum = (sum + byte) >>> 0
      report(
        `recorded ${JSON.stringify({ bytes: buffer.byteLength, sum, mimeType: buffer.mimeType, filename: buffer.filename })}`,
      )
      if (!(await speaker.play(buffer))) throw new Error('Recorded audio did not play')
    }
    await speaker.tone(440, 30)
    report('tone completed')
    const cancelledTone = speaker.tone(440, 15_000).then(
      () => {
        throw new Error('Cancelled tone succeeded')
      },
      (error) => {
        if (error.code !== 'CANCELLED') throw error
      },
    )
    Timer.set(() => {
      Promise.resolve(speaker.cancelPlayback()).catch((error) => report(`FAIL ${error}`))
    }, 100)
    await cancelledTone
    report('tone cancelled')
    const cancelled = microphone.record(15_000).then(
      () => {
        throw new Error('Cancelled recording succeeded')
      },
      (error) => {
        if (error.code !== 'CANCELLED') throw error
      },
    )
    Timer.set(() => {
      Promise.resolve(microphone.stop()).catch((error) => report(`FAIL ${error}`))
    }, 100)
    await cancelled
    report('cancelled')
    report('microphone close begin')
    await microphone.close()
    await new Microphone().close()
    report('microphone close end')
    input(app).onPress('primary', () => {
      const input = new Microphone()
      inputs.add(input)
      input.record(15_000).then(
        () => report('long recording completed'),
        (error) => report(`long recording ${error.code}`),
      )
      report('long recording started')
    })
    input(app).onPress('secondary', () => {
      speaker.play(recorded).then(
        () => report('buffer completed'),
        (error) => report(`buffer ${error.code}`),
      )
    })
    input(app).onPress('tertiary', () => {
      speaker.tone(440, 15_000).then(
        () => report('long tone completed'),
        (error) => report(`long tone ${error.code}`),
      )
    })
    report('ready')
    return async () => {
      await Promise.all([...inputs].map((microphone) => microphone.close()))
      await speaker.close()
    }
  },
})
