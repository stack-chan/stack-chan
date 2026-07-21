import startUsbAudioBridge, { type UsbAudioBridgeControl, type UsbAudioPresentation } from 'stackchan-usb-audio-core'
import { type SharedSpeakerOutputBuffers, SharedSpeakerOutputService } from 'stackchan-usb-shared-output'
import type { Self } from 'worker'

declare const self: Self

let bridge: UsbAudioBridgeControl | undefined
let outputService: SharedSpeakerOutputService | undefined

const presentation: UsbAudioPresentation = {
  onStatusChanged(status) {
    self.postMessage({ id: 'status-changed', status })
  },
  onPlaybackStarted() {
    self.postMessage({ id: 'playback-started' })
  },
  onPlaybackPower() {},
  onPlaybackText(text) {
    self.postMessage({ id: 'playback-text', text, position: outputService?.writtenBytes ?? 0 })
  },
  onPlaybackStopped() {
    self.postMessage({ id: 'playback-stopped' })
  },
}

function closeWorker(): void {
  bridge?.close()
  bridge = undefined
  outputService?.close()
  outputService = undefined
  try {
    self.postMessage({ id: 'closed' })
  } finally {
    self.close()
  }
}

self.onmessage = (message: {
  id?: string
  speakerVolume?: number
  diagnostics?: boolean
  output?: SharedSpeakerOutputBuffers
}) => {
  try {
    switch (message.id) {
      case 'start':
        if (bridge) return
        if (!message.output) throw new TypeError('shared speaker output is required')
        outputService = new SharedSpeakerOutputService(message.output, (next) => self.postMessage(next))
        bridge = startUsbAudioBridge({
          speakerVolume: message.speakerVolume,
          diagnostics: message.diagnostics,
          createSpeakerOutput: outputService.createOutput,
        })
        bridge.setPresentation(presentation)
        self.postMessage({ id: 'ready' })
        break
      case 'audio-drained':
        outputService?.handleDrained()
        break
      case 'audio-failed':
        outputService?.handleFailed()
        break
      case 'close':
        closeWorker()
        break
    }
  } catch (error) {
    self.postMessage({ id: 'error', reason: error instanceof Error ? error.message : String(error) })
  }
}
