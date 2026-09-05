import AXP2101 from 'embedded:peripheral/Power/axp2101'

// SDK 9.5's embedded peripheral uses readUint8/writeUint8. The separate
// legacy drivers/axp2101 module uses readByte/writeByte and is not imported here.
let capturedPower

function capture(power) {
  if (!capturedPower) capturedPower = power
}

const readUint8 = AXP2101.prototype.readUint8
AXP2101.prototype.readUint8 = function (...args) {
  capture(this)
  return readUint8.apply(this, args)
}

const writeUint8 = AXP2101.prototype.writeUint8
AXP2101.prototype.writeUint8 = function (...args) {
  capture(this)
  return writeUint8.apply(this, args)
}

export function getAxp2101Power() {
  return capturedPower
}
