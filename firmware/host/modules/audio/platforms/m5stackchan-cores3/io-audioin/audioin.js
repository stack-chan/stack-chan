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

class AudioIn extends Native('xs_audioin_destructor') {
  constructor(dictionary) {
    super()
    native('xs_audioin_constructor').call(this, dictionary)
  }
  close() {
    return native('xs_audioin_close').call(this)
  }
  read(samples) {
    return native('xs_audioin_read').call(this, samples)
  }
  level(samples) {
    return native('xs_audioin_level').call(this, samples)
  }
  start() {
    return native('xs_audioin_start').call(this)
  }
  stop() {
    return native('xs_audioin_stop').call(this)
  }

  get format() {
    return native('xs_audioin_get_format').call(this)
  }
  set format(it) {
    native('xs_audioin_set_format').call(this, it)
  }

  get bitsPerSample() {
    return native('xs_audioin_get_bitsPerSample').call(this)
  }
  get channels() {
    return native('xs_audioin_get_channels').call(this)
  }
  get sampleRate() {
    return native('xs_audioin_get_sampleRate').call(this)
  }
  get audioType() {
    return 'LPCM'
  }

  static {
    this.prototype[Symbol.dispose] = this.prototype.close
  }
}

export default AudioIn
