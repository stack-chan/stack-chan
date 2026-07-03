import MDNS from 'mdns'

function onContextCreated(robot) {
  const mdns = new MDNS({})
  const txt = {}
  const rotation = {
    y: 0.0,
    p: 0.0,
    r: 0.0,
  }
  mdns.monitor('_http._tcp', (_service, instance) => {
    if (instance.name === 'stackchan') {
      for (const s of instance.txt) {
        const entry = s.split('=')
        txt[entry[0]] = entry[1]
      }
      rotation.y = txt.yaw
      rotation.p = txt.pitch
      trace(`____got! yaw: ${txt.yaw} pitch: ${txt.pitch}\n`)
      robot.motion.setPose({ rotation }, 0.1)
    }
  })
}
export default {
  onContextCreated,
}
