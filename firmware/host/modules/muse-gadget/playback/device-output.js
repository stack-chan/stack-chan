import PcmPage from 'muse-buffered-pcm-page'
import { createBufferedPlayback } from 'muse-buffered-playback'

export function bufferOutput(sampleRate, volume, openOutput) {
  const output = createBufferedPlayback({
    allocatePage: () => new PcmPage(),
    openOutput,
    streamingLeadBytes: 35 * sampleRate * 2,
    volume,
  })
  return {
    get frames() {
      return output.submittedFrames
    },
    allowStreaming: output.allowStreaming,
    setVolume: output.setVolume,
    write(bytes, onAccepted) {
      output.write(bytes)
      onAccepted?.(bytes.length)
    },
    drain: output.drain,
    close: output.close,
  }
}

export function openBufferedOutput(driver, sampleRate, volume, limit, onLevel) {
  if (driver.openBufferedOutput) return driver.openBufferedOutput(sampleRate, volume, limit, onLevel)
  return bufferOutput(sampleRate, volume, (gain) => driver.openOutput(sampleRate, gain, limit, onLevel))
}
