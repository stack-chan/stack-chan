import MDNS from 'mdns'
import Timer from 'timer'

let initialized = false
function onRobotCreated(robot) {
  const mdns = new MDNS(
    {
      hostName: 'stackchan',
    },
    function (message, value) {
      switch (message) {
        case 1:
          if (value !== '') {
            trace(`MDNS - connection successful. claimed hostname is "${value}"\n`)
            mdns.add({
              name: 'http',
              protocol: 'tcp',
              port: 80,
              txt: {
                yaw: '0.0',
                pitch: '0.0',
              },
            })
            initialized = true
          }
          break
        case 2:
          trace(`MDNS - failed to claim "${value}", try next\n`)
          break
        default:
          if (message < 0) trace('MDNS - failed to claim, give up\n')
          break
      }
    }
  )
  Timer.repeat(() => {
    let yaw = robot.pose.body.rotation.y
    let pitch = robot.pose.body.rotation.p
    if (initialized && mdns.services.length > 0) {
      let service = mdns.services[0]
      service.txt['yaw'] = yaw
      service.txt['pitch'] = pitch
      mdns.update(service)
    }
  }, 100)
}
export default {
  onRobotCreated,
  autoLoop: false,
}
