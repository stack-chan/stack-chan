/** Public capability names and the host generation that introduced their SDK entrypoints. */
export const CAPABILITY_HOST_API_VERSIONS = Object.freeze({
  face: 2,
  'audio.speech': 2,
  'audio.clips': 2,
  'audio.tone': 2,
  'audio.recording': 2,
  'audio.playback': 2,
  'audio.singing': 8,
  'input.primary': 2,
  'input.secondary': 4,
  'input.tertiary': 4,
  'input.headTouch': 4,
  'input.motion': 4,
  'input.primary.release': 8,
  'input.secondary.release': 8,
  'input.tertiary.release': 8,
  lighting: 4,
  motion: 2,
  camera: 2,
  'ui.piu': 3,
  'ui.controls': 4,
  settings: 7,
  'network.http': 7,
  'network.peer': 7,
  'network.ble': 7,
  'network.dnssd': 7,
  'conversation.dialogue': 7,
  'conversation.realtime': 7,
  'conversation.remote': 7,
  'audio.monitor': 7,
  'audio.radio': 7,
  'sensors.temperature': 7,
  'motion.maintenance': 7,
})

/** @typedef {keyof typeof CAPABILITY_HOST_API_VERSIONS} CapabilityId */
export const CAPABILITY_IDS = Object.freeze(/** @type {CapabilityId[]} */ (Object.keys(CAPABILITY_HOST_API_VERSIONS)))

/** @param {string} id @returns {id is CapabilityId} */
export function isCapabilityId(id) {
  return Object.hasOwn(CAPABILITY_HOST_API_VERSIONS, id)
}
