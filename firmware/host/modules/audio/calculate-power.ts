function calculatePower(this: unknown, sample: ArrayBuffer): number {
  return native('xs_calculatePower').call(this, sample)
}
export default calculatePower
