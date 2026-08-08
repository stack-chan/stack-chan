/*
 * Copyright (c) 2024-2026 Moddable Tech, Inc.
 *
 * SPDX-License-Identifier: LGPL-3.0-or-later
 *
 * This distinct module name keeps the physical ESP32 AudioOut binding available
 * when the public embedded:io/audio/out module is replaced by SharedAudioOut.
 */

class PhysicalAudioOut extends Native('xs_audioout_destructor_') {
  constructor(options) {
    super()
    native('xs_audioout_constructor_').call(this, options)
  }

  close() {
    return native('xs_audioout_close_').call(this)
  }

  start() {
    return native('xs_audioout_start_').call(this)
  }

  stop() {
    return native('xs_audioout_stop_').call(this)
  }

  write(samples) {
    return native('xs_audioout_writeSync_').call(this, samples)
  }

  get format() {
    return native('xs_audioout_get_format_').call(this)
  }

  set format(value) {
    native('xs_audioout_set_format_').call(this, value)
  }

  get bitsPerSample() {
    return native('xs_audioout_get_bitsPerSample_').call(this)
  }

  get channels() {
    return native('xs_audioout_get_numChannels_').call(this)
  }

  get sampleRate() {
    return native('xs_audioout_get_sampleRate_').call(this)
  }

  get audioType() {
    return 'LPCM'
  }

  get volume() {
    return native('xs_audioout_get_volume_').call(this)
  }

  set volume(value) {
    native('xs_audioout_set_volume_').call(this, value)
  }

  static {
    PhysicalAudioOut.prototype[Symbol.dispose] = PhysicalAudioOut.prototype.close
  }
}

PhysicalAudioOut.Async = class extends PhysicalAudioOut {
  write(samples, callback) {
    return native('xs_audioout_writeAsync_').call(this, samples, callback)
  }
}

export default PhysicalAudioOut
