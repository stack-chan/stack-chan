import { createResampledOutput } from 'muse-resampled-output'
import * as driver from 'muse-stopwatch-output'
import resample from 'pcm-resampler'
import { bufferOutput } from 'stackchan/voice/buffered-pcm-output'
import Time from 'time'
import Timer from 'timer'

function openDriver(sampleRate, volume, limit, onLevel, startupBlocks) {
  return driver.openOutput(
    sampleRate,
    volume,
    limit,
    onLevel,
    {
      now: () => Time.ticks,
      emitFirstSend: (at) => trace(`MUSE_HOST ${at} first_dma_write\n`),
      emit: (values) => trace(`MUSE_SINK ${values.join(' ')}\n`),
      emitSupply: (values) => trace(`MUSE_SUPPLY ${values.join(' ')}\n`),
    },
    startupBlocks === 3
      ? { setTimer: (callback, ms) => Timer.set(callback, ms), clearTimer: (timer) => Timer.clear(timer) }
      : undefined,
  )
}

const streaming = createResampledOutput({ ...driver, resample, openOutput: openDriver })
const buffered = createResampledOutput({
  ...driver,
  resample,
  openOutput: (sampleRate, volume, limit, onLevel) => {
    const output = bufferOutput(sampleRate, volume, (gain) => openDriver(sampleRate, gain, limit, onLevel, 3))
    Object.defineProperty(output, 'submittedFrames', { get: () => output.frames })
    return output
  },
})
export const minimumOutputBytes = streaming.minimumOutputBytes
export const openOutput = streaming.openOutput
export function openBufferedOutput(sampleRate, volume, limit, onLevel) {
  return buffered.openOutput(sampleRate, volume, limit, onLevel, 3)
}
