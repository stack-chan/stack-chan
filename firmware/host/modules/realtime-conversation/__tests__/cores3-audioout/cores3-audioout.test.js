import AudioOut, { Mixer } from 'pins/audioout'
import { Mixer as OriginalMixer, outputs } from 'pins/audioout-original'
import { assert, equal } from 'testing/assert'

try {
  equal(Mixer, OriginalMixer, 'legacy mixer export is preserved')
  const rates = []
  globalThis.amp = {
    set sampleRate(rate) {
      rates.push(rate)
    },
  }
  const first = new AudioOut({ sampleRate: 16000 })
  const second = new AudioOut({ sampleRate: 24000 })
  equal(rates[0], first.sampleRate, 'first playback coordinates its actual rate')
  equal(rates[1], second.sampleRate, 'later playback restores its own rate')
  first.close()
  second.close()

  const failure = new Error('amplifier write failed')
  globalThis.amp = {
    set sampleRate(_rate) {
      throw failure
    },
  }
  let caught
  try {
    new AudioOut({ sampleRate: 48000 })
  } catch (error) {
    caught = error
  }
  equal(caught, failure, 'codec failure is visible to the caller')
  assert(outputs[outputs.length - 1].closed, 'codec failure releases the allocated audio output')

  globalThis.amp = {
    set sampleRate(rate) {
      rates.push(rate)
    },
  }
  const retry = new AudioOut({ sampleRate: 24000 })
  equal(rates[rates.length - 1], retry.sampleRate, 'playback can configure its amp after a failed attempt')
  retry.close()

  delete globalThis.amp
  const noAmp = new AudioOut({ sampleRate: 22050 })
  equal(noAmp.sampleRate, 22050, 'a missing amp does not change the audio driver contract')
  noAmp.close()
  trace('@@STACKCHAN_TEST:PASS@@\n')
} catch (error) {
  trace(`${String(error)}\n`)
  trace('@@STACKCHAN_TEST:FAIL@@\n')
} finally {
  delete globalThis.amp
}
