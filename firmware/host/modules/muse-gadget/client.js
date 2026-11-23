import MuseNative from 'muse-native'
import { MuseSession } from 'muse-session'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import Timer from 'timer'

export function createMuseSession(options, callbacks = {}) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  return new MuseSession(options, {
    open: (configuration, onEvent) => new MuseNative(configuration, onEvent),
    setTimer: (callback, milliseconds) => Timer.set(callback, milliseconds),
    clearTimer: (handle) => Timer.clear(handle),
    encode: (value) => encoder.encode(value).buffer,
    decode: (value) => decoder.decode(value),
    ...callbacks,
  })
}
