import { getAxp2101Power } from 'embedded:peripheral/Power/axp2101'
import { readAxp2101BatteryLevel } from 'battery-level'

export default function readBatteryLevel(): number | undefined {
  const power = getAxp2101Power()
  if (!power) return undefined
  try {
    return readAxp2101BatteryLevel((register) => power.readByte(register))
  } catch {
    return undefined
  }
}
