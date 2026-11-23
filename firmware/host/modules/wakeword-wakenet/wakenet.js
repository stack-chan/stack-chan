// SPDX-License-Identifier: Apache-2.0

export default class WakeNet extends Native('xs_stackchan_wakenet_delete') {
  start() {
    return native('xs_stackchan_wakenet_start').call(this)
  }

  get chunkSamples() {
    return native('xs_stackchan_wakenet_chunk_samples').call(this)
  }

  detect(pcm) {
    return native('xs_stackchan_wakenet_detect').call(this, pcm)
  }

  reset() {
    native('xs_stackchan_wakenet_reset').call(this)
  }

  close() {
    native('xs_stackchan_wakenet_close').call(this)
  }
}
