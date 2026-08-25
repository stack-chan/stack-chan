import AXP2101 from 'embedded:peripheral/Power/axp2101'

let capturedPower

function capture(power) {
  if (!capturedPower) capturedPower = power
}

const readByte = AXP2101.prototype.readByte
AXP2101.prototype.readByte = function (...args) {
  capture(this)
  return readByte.apply(this, args)
}

const writeByte = AXP2101.prototype.writeByte
AXP2101.prototype.writeByte = function (...args) {
  capture(this)
  return writeByte.apply(this, args)
}

export function getAxp2101Power() {
  return capturedPower
}
