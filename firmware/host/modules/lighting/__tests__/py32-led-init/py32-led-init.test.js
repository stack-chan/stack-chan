import { getSharedPY32IOExpander } from 'py32-io-expander'
import PY32Led from 'py32-led'
import { assert, equal } from 'testing/assert'

// Model a device that remains busy while applying LED_CFG. Exercise the real
// LED driver, IO expander, and SDK Timer; only the physical SMBus is replaced.
const registers = new Map([[0x02, 0x41]])
const writes = []
let readyAt = 0
let countCompletedAt = 0
let firstRGBAt = 0
let failRegister
const busError = new Error('injected SMBus write failure')

class BusyLEDDevice {
  readUint8(register) {
    return registers.get(register) ?? 0
  }
  writeUint8(register, value) {
    writes.push({ register, value })
    if (register === failRegister) throw busError
    registers.set(register, value)
    if (register === 0x24 && !(value & 0x40)) {
      countCompletedAt = Date.now()
      // Device readiness is independent of the production wait literal.
      readyAt = countCompletedAt + 180
      firstRGBAt = 0
    }
  }
  writeBuffer(register, buffer) {
    if (!firstRGBAt) firstRGBAt = Date.now()
    writes.push({ register, bytes: Array.from(buffer) })
    if (register === failRegister) throw busError
    if (Date.now() < readyAt) throw new Error('LED device is still applying its count')
  }
}

getSharedPY32IOExpander({ sensor: { io: BusyLEDDevice } })
const led = new PY32Led({ length: 3 })
assert(firstRGBAt >= readyAt, 'first RGB write must wait for count application')
trace(`count-to-RGB gap: ${firstRGBAt - countCompletedAt}ms\n`)
const colors = writes.filter((write) => write.bytes)
equal(colors.length, led.length, 'initialization clears every configured LED')
for (let index = 0; index < colors.length; index++) {
  equal(colors[index].register, 0x30 + index * 2, 'clear each RGB565 address')
  equal(colors[index].bytes.join(','), '0,0', 'initial color is off')
}
equal(writes.at(-1).value, led.length | 0x40, 'refresh follows the initial colors')

writes.length = 0
led.on(255, 0, 0)
equal(writes.filter((write) => write.bytes).length, led.length, 'later colors still work')
equal(
  writes.filter((write) => write.register === 0x24 && !(write.value & 0x40)).length,
  0,
  'later colors do not reconfigure the LED count',
)

function expectFailure(register) {
  writes.length = 0
  failRegister = register
  let caught
  try {
    new PY32Led({ length: 3 })
  } catch (error) {
    caught = error
  }
  equal(caught, busError, 'preserve the original SMBus exception')
  equal(writes.at(-1).register, register, 'stop at the failing transfer')
  equal(writes.filter((write) => write.register === register).length, 1, 'do not retry a failed transfer')
  equal(
    writes.filter((write) => write.register === 0x24 && write.value & 0x40).length,
    0,
    'do not refresh an incomplete initialization',
  )
}
expectFailure(0x04)
equal(writes.filter((write) => write.register === 0x24).length, 0, 'GPIO failure prevents LED count setup')
expectFailure(0x30)
assert(firstRGBAt >= readyAt, 'the error path also respects device readiness')

trace('@@STACKCHAN_TEST:PASS@@\n')
