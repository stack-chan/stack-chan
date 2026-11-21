const prefix =
  'data: {"event_type":"step.delta","delta":{"type":"audio","mime_type":"audio/l16;rate=24000;channels=1","data":"'
const suffix = '"}}'
export function audioEventLayout(eventBytes) {
  if (eventBytes !== 8192 && eventBytes !== 65536) throw new RangeError('unsupported fixture size')
  const available = eventBytes - prefix.length - suffix.length - 2
  const base64Bytes = Math.floor(available / 8) * 8
  return {
    prefix,
    suffix: suffix + ' '.repeat(available - base64Bytes) + '\n\n',
    base64Bytes,
    pcmBytes: (base64Bytes / 4) * 3,
  }
}
export async function replayAudioEvent(eventBytes, consume, active) {
  const layout = audioEventLayout(eventBytes)
  const slab = new Uint8Array(1024).fill(65)
  const send = async (bytes) => {
    active()
    await consume(bytes)
    active()
  }
  await send(new Uint8Array(ArrayBuffer.fromString(layout.prefix)))
  for (let remaining = layout.base64Bytes; remaining > 0; remaining -= 1024)
    await send(slab.subarray(0, Math.min(remaining, 1024)))
  await send(new Uint8Array(ArrayBuffer.fromString(layout.suffix)))
  return layout.pcmBytes
}
