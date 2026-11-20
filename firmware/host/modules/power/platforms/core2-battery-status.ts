import { readCore2BatteryLevel } from 'battery-level'

type PowerRegisterReader = {
  readByte(register: number): number
}

type PowerEnvironment = typeof globalThis & {
  power?: PowerRegisterReader
}

export default function readBatteryLevel(): number | undefined {
  const power = (globalThis as PowerEnvironment).power
  if (!power?.readByte) return undefined
  try {
    return readCore2BatteryLevel((register) => power.readByte(register))
  } catch {
    return undefined
  }
}
