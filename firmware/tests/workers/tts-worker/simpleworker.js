/*
 * Copyright (c) 2016-2017  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK.
 *
 *   This work is licensed under the
 *       Creative Commons Attribution 4.0 International License.
 *   To view a copy of this license, visit
 *       <http://creativecommons.org/licenses/by/4.0>.
 *   or send a letter to Creative Commons, PO Box 1866,
 *   Mountain View, CA 94042, USA.
 *
 */

// import { DynamixelDriver } from 'dynamixel-driver'
// import Timer from 'timer'

import { TTS } from 'tts-local'
const tts = new TTS({
  sampleRate: 11000,
  onPlayed: (number) => {
    self.postMessage({ type: 'onPlayed', value: number })
  },
})
// const driver = new DynamixelDriver

self.onmessage = async function (msg) {
  await tts.stream('01-yay')
  self.postMessage({
		type: 'onDone',
    value: null,
  })
}
