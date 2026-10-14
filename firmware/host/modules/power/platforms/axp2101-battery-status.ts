import { getAxp2101Power } from 'axp2101-power-capture'
import { readAxp2101BatteryLevel } from 'battery-level'

/** Read the captured peripheral battery percentage, or return undefined when unavailable. */
export default function readBatteryLevel(): number | undefined {
  const power = getAxp2101Power()
  if (!power) return undefined
  try {
    return readAxp2101BatteryLevel((register) => power.readUint8(register))
  } catch {
    return undefined
  }
}
