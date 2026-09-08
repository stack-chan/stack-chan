import { getSettingsService } from 'loadPreference'
import { createAppConversation } from 'app-conversation'
import { createAppNetwork } from 'app-network'
import { AppConnection, type AppExtensions, type AppServiceScope } from 'app-service-scope'
import type { ConnectivityCapability, RemoteConversationSession } from 'capabilities'
import Modules from 'modules'
import type { StackchanRuntimeAudio } from 'runtime-audio'
import type { MaintenanceCommand, ServoMaintenancePort } from 'servo-maintenance'
import { StackchanError } from 'stackchan/errors'
import type { ServoStatus } from 'stackchan/extensions/maintenance'
import type { AppSettings } from 'stackchan/extensions/settings'

export function createAppExtensions(
  scope: AppServiceScope,
  ports: {
    audio: StackchanRuntimeAudio
    connectivity: ConnectivityCapability
    remote?: RemoteConversationSession
    maintenance?: ServoMaintenancePort
    maintain<T>(operation: () => Promise<T>, resume?: boolean): Promise<T>
  },
): AppExtensions {
  const service = getSettingsService()
  const settings: AppSettings = {
    get: (key) => scope.call(() => service.get(key)),
    describe: (key) => scope.call(() => service.describe(key)),
    set: (key, value) => scope.call(() => service.set(key, value)),
  }
  const audio = ports.audio
  const maintain = (command: MaintenanceCommand) =>
    scope.run(() => {
      const driver = ports.maintenance
      if (!driver) throw new StackchanError('UNSUPPORTED', 'Servo maintenance is unavailable')
      return ports.maintain(
        () =>
          new Promise<ServoStatus | undefined>((resolve, reject) => {
            driver.execute(command, (error, status) => (error == null ? resolve(status) : reject(error)))
          }),
        command.operation !== 'baudrate',
      )
    })
  return {
    settings,
    network: createAppNetwork(scope, ports.connectivity),
    conversation: createAppConversation(scope, settings, audio, ports.remote),
    maintenance: ports.maintenance
      ? {
          kind: ports.maintenance.kind,
          read: async (axis) => {
            const status = await maintain({ operation: 'read', axis })
            if (!status) throw new StackchanError('IO', 'Servo returned no status')
            return status
          },
          calibrate: async (axis) => {
            await maintain({ operation: 'calibrate', axis })
          },
          setLed: async (axis, enabled) => {
            await maintain({ operation: 'led', axis, enabled })
          },
          setId: async (axis, id) => {
            await maintain({ operation: 'id', axis, id })
          },
          setBaudrate: async (baudrate) => {
            await maintain({ operation: 'baudrate', axis: 'pan', baudrate })
          },
        }
      : undefined,
    sensors: {
      openTemperature: () =>
        scope.call(() => {
          const environment = (globalThis as { device?: { I2C?: { default?: object } } }).device?.I2C?.default
          if (!environment || !Modules.has('embedded:sensor/Humidity-Temperature/SHT3x'))
            throw new StackchanError('UNSUPPORTED', 'SHT3x requires an external I²C bus on this target')
          const owner = new AppConnection(scope)
          try {
            const Sensor = Modules.importNow('embedded:sensor/Humidity-Temperature/SHT3x') as new (options: {
              sensor: object
            }) => {
              close(): void
              sample(): { thermometer: { temperature: number }; hygrometer: { humidity: number } }
            }
            const sensor = new Sensor({ sensor: environment })
            owner.own(() => sensor.close())
            return {
              close: owner.close,
              sample: () =>
                owner.call(() => {
                  const result = sensor.sample()
                  const temperatureC = result.thermometer.temperature,
                    relativeHumidityPercent = result.hygrometer.humidity
                  if (!Number.isFinite(temperatureC) || !Number.isFinite(relativeHumidityPercent))
                    throw new StackchanError('IO', 'Temperature sensor returned invalid data')
                  return { temperatureC, relativeHumidityPercent }
                }),
            }
          } catch (error) {
            void owner.close().catch(scope.report)
            throw error
          }
        }),
    },
    streamingAudio: {
      monitor: (handler) =>
        scope.run(async () => {
          const owner = new AppConnection(scope)
          try {
            const microphone = audio.microphone
            if (!microphone?.monitor) throw new StackchanError('UNSUPPORTED', 'Live microphone levels are unavailable')
            owner.own(audio.reserveStream(true, false))
            owner.own(async () => {
              try {
                await microphone.stop()
              } catch (error) {
                audio.failStream(error)
                throw error
              }
            })
            microphone.monitor(owner.event(handler))
            return owner
          } catch (error) {
            await owner.close()
            throw error
          }
        }),
      radio: (options) =>
        scope.run(async () => {
          const owner = new AppConnection(scope)
          try {
            const radio = audio.streamingRadio
            if (!radio) throw new StackchanError('UNSUPPORTED', 'MP3 radio is unavailable on this target')
            owner.own(audio.reserveStream(false, true))
            owner.own(() => {
              try {
                radio.stop()
              } catch (error) {
                audio.failStream(error)
                throw error
              }
            })
            await radio.start({ ...options, sampleRate: 44_100, onStateChanged: owner.event(options.onState) })
            owner.call(() => {})
            return owner
          } catch (error) {
            await owner.close()
            throw error
          }
        }),
    },
  }
}
