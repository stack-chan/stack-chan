import MDNS from "mdns"
import Timer from "timer"
import { Target } from 'robot'

function onRobotCreated(robot) {
  const mdns = new MDNS({})
  let txt = {}
  let pose = {
    yaw: 0.0,
    pitch: 0.0
  }
  mdns.monitor("_http._tcp", (service, instance) => {
    if (instance.name === "stackchan") {
      for (let s of instance.txt) {
        let entry = s.split("=")
        txt[entry[0]] = entry[1]
      }
      pose.yaw = txt.yaw
      pose.pitch = txt.pitch
      trace(`____got! yaw: ${txt.yaw} pitch: ${txt.pitch}\n`)
      robot._driver.applyPose(pose, 0.1)
    }
  })
}
export default {
  onRobotCreated,
  autoLoop: false
}
