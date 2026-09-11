import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
export type ServoAxis = 'pan' | 'tilt'
export type ServoKind = 'scservo' | 'dynamixel' | 'rs30x'
export type ServoStatus = { axis: ServoAxis; angleDeg: number; offsetDeg?: number; current?: number; velocity?: number }
/** Maintenance uses the configured driver and its bus. It never opens another UART. */
export interface AppMaintenance {
  readonly kind: ServoKind
  read(axis: ServoAxis): Promise<ServoStatus>
  /** Save the current physical position as the driver's neutral position. */
  calibrate(axis: ServoAxis): Promise<void>
  setLed(axis: ServoAxis, enabled: boolean): Promise<void>
  /** Persistent writes require an explicit action in the application UI. */
  setId(axis: ServoAxis, id: number): Promise<void>
  /** Change both configured bus endpoints, then require a host restart at the new rate. */
  setBaudrate(baudrate: number): Promise<void>
}
export function maintenance(app: AppContext): AppMaintenance {
  const value = (app as AppContext & { maintenance?: AppMaintenance }).maintenance
  if (!value) throw new StackchanError('UNSUPPORTED', 'This driver does not support servo maintenance')
  return value
}
