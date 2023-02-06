import MDNS from 'mdns'

function onRobotCreated(robot) {
  const mdns = new MDNS({})
  let txt = {}
  const rotation = {
    y: 0.0,
    p: 0.0,
    r: 0.0,
  }
  mdns.monitor('_http._tcp', (service, instance) => {
    if (instance.name === 'stackchan') {
      for (let s of instance.txt) {
        let entry = s.split('=')
        txt[entry[0]] = entry[1]
      }
      rotation.y = txt.yaw
      rotation.p = txt.pitch
      trace(`____got! yaw: ${txt.yaw} pitch: ${txt.pitch}\n`)
      robot.setPose({ rotation }, 0.1)
    }
  })
}
export default {
  onRobotCreated,
}
