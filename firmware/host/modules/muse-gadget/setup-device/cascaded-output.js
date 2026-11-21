import { createBufferedPlayback } from 'muse-buffered-playback'
import PcmPage from 'muse-buffered-pcm-page'
import nativeGeminiTransport from 'muse-native-speech-enabled'
import { createResampledOutput } from 'muse-resampled-output'
import * as output from 'muse-stopwatch-output'
import resample from 'pcm-resampler'
import Time from 'time'
import Timer from 'timer'

function openDriver(sampleRate, volume, limit, onLevel, startupBlocks = 1) {
  return output.openOutput(
    sampleRate,
    volume,
    limit,
    onLevel,
    {
      now: () => Time.ticks,
      emit: (values) => trace(`MUSE_SINK ${values.join(' ')}\n`),
      emitSupply: (values) => trace(`MUSE_SUPPLY ${values.join(' ')}\n`),
    },
    startupBlocks === 3
      ? {
          setTimer: (callback, ms) => Timer.set(callback, ms),
          clearTimer: (timer) => Timer.clear(timer),
        }
      : undefined,
  )
}

const streaming = createResampledOutput({ ...output, resample, openOutput: openDriver })
const buffered = createResampledOutput({
  ...output,
  resample,
  openOutput: (sampleRate, volume, limit, onLevel, startupBlocks) =>
    createBufferedPlayback({
      allocatePage: () => new PcmPage(),
      openOutput: (gain) => openDriver(sampleRate, gain, limit, onLevel, startupBlocks),
      streamingLeadBytes: 35 * sampleRate * 2,
      volume,
    }),
})
export const minimumOutputBytes = streaming.minimumOutputBytes
export const openStreamingOutput = streaming.openOutput
export function openOutput(sampleRate, volume, limit, onLevel, startupBlocks = 1) {
  const playback = nativeGeminiTransport && sampleRate === 24000 && startupBlocks === 3 ? buffered : streaming
  return playback.openOutput(sampleRate, volume, limit, onLevel, startupBlocks)
}
