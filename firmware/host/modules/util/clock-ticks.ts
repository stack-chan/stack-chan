import Time from 'time'

/** Platform milliseconds for elapsed-time calculations; callers handle 32-bit wrap. */
export default function clockTicks(): number {
  return Time.ticks
}
