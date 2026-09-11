import { BeaconDataPacket } from 'beacon-packet'
import { Bytes } from 'btutils'
import { assert, equal } from 'testing/assert'

const uuid = new Bytes('0123456789ABCDEF1032547698BADCFE', false)
for (let cycle = 0; cycle < 100; cycle++) {
  const original = new BeaconDataPacket(uuid, cycle, 65535 - cycle, -40)
  // Receive buffers can contain other data before and after the advertised payload.
  for (const prefix of [0, 5]) {
    const frame = new Uint8Array(prefix + original.payload.length + 3).fill(0xaa)
    frame.set(original.payload, prefix)
    const parsed = BeaconDataPacket.parse(frame.subarray(prefix, prefix + 23))
    assert(parsed.success)
    equal(parsed.value.major, cycle, 'major must use the supplied view offset')
    equal(parsed.value.minor, 65535 - cycle)
    equal(parsed.value.txPower, -40)
    assert(parsed.value.uuid.equals(uuid), 'receiving must preserve the advertised UUID byte order')
    equal(Array.from(parsed.value.payload).join(','), Array.from(original.payload).join(','))
    frame.fill(0)
    assert(parsed.value.uuid.equals(uuid), 'parsed data must not retain the mutable receive frame')
  }
}
for (const bytes of [new Uint8Array(22), new Uint8Array(24), new Uint8Array(23)])
  equal(BeaconDataPacket.parse(bytes).success, false)
trace('ok\n')
