//  PWM Stub for Simulator
class PWM {
  close() {}
  write(_value) {}
  get hz() {
    return 0
  }
  get resolution() {
    return 0
  }

  get format() {
    return 'number'
  }

  set format(value) {
    if ('number' !== value) throw new RangeError()
  }
}

export default PWM
