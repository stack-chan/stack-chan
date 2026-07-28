import AXP2101 from 'embedded:peripheral/Power/axp2101-base'

let capturedPower

export function getAxp2101Power() {
  return capturedPower
}

export default class CapturedAXP2101 extends AXP2101 {
  constructor(options) {
    super(options)
    capturedPower = this
  }
}
