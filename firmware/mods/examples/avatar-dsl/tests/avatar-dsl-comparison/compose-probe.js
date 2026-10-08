// SPDX-License-Identifier: Apache-2.0
import { createStackchanContext as create, getHostDeviceEnvironment } from 'compose-real'

export { getHostDeviceEnvironment }
export function createStackchanContext(preferences, options) {
  try {
    return create(preferences, options)
  } catch (error) {
    const message = String(error?.message ?? '')
    const category = /i2c|write fail|write error/i.test(message)
      ? 'i2c-write'
      : /camera/i.test(message)
        ? 'camera'
        : /memory|allocation/i.test(message)
          ? 'memory'
          : 'other'
    trace(`[AVDS-DEVICE] CONTEXT ERROR category=${category} class=${error?.name ?? 'Error'}\n`)
    throw error
  }
}
