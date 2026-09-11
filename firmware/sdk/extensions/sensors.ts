import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import type { Connection } from 'stackchan/extensions/network'
export interface TemperatureSensor extends Connection {
  sample(): { temperatureC: number; relativeHumidityPercent: number }
}
export interface AppSensors {
  /** Open an SHT3x on the board's default external I²C bus. */
  openTemperature(): TemperatureSensor
}
export function sensors(app: AppContext): AppSensors {
  const value = (app as AppContext & { sensors?: AppSensors }).sensors
  if (!value) throw new StackchanError('UNSUPPORTED', 'External sensors are unavailable')
  return value
}
