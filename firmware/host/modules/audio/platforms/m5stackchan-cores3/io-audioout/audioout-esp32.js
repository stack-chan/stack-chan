/*
 * Copyright (c) 2024-2026  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

class AudioOut extends Native('xs_audioout_destructor_') {
  constructor(dictionary) {
    super()
    native('xs_audioout_constructor_').call(this, dictionary)
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
  set format(it) {
    native('xs_audioout_set_format_').call(this, it)
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
  set volume(it) {
    native('xs_audioout_set_volume_').call(this, it)
  }

  static {
    this.prototype[Symbol.dispose] = this.prototype.close
  }
}

AudioOut.Async = class extends AudioOut {
  write(samples, callback) {
    return native('xs_audioout_writeAsync_').call(this, samples, callback)
  }
}

export default AudioOut
