import { readIp5306BatteryLevel } from 'battery-level'
import SMBus from 'pins/smbus'

export default function readBatteryLevel(): number | undefined {
  let bus: SMBus | undefined
  try {
    bus = new SMBus({ address: 0x75 })
    return readIp5306BatteryLevel((register) => (bus as SMBus).readByte(register))
  } catch {
    return undefined
  } finally {
    bus?.close()
  }
}
