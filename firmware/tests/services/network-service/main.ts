import { NetworkService } from 'network-service'

const service = new NetworkService({
  ssid: 'myssid',
  password: 'mypassword',
})

service.connect(
  () => {
    trace('connected\n')
  },
  (message) => {
    trace(`error: ${message}\n`)
  }
)
