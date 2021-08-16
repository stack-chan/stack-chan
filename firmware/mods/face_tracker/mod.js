import { Request } from "http"
import { Target } from 'robot'

function onRobotCreated(robot) {
  const target = new Target(0.6, 0, 0)
  let characterCount = 0;
  let request = new Request({ host: "192.168.7.126", path: "/func/result", method: "POST" });
  request.callback = function (message, value, etc) {
    if (Request.responseFragment === message) {
      let text = this.read(String);
      characterCount += text.length;
      let str = text.split('|')[0]
      let data
      try {
        data = JSON.parse(str)
      } catch (e) {
        trace('parse fail \n')
        return
      }
      let faces = data.face
      if (faces != null && faces.length == 0) {
        trace('no face detected \n')
        return
      }
      let face = faces[0]
      let centerX = face.x + face.w / 2
      let centerY = face.y + face.h / 2
      target.y = (320 - centerX) / 320
      target.z = -centerY / 480
    }
    if (Request.responseComplete == message)
      trace(`\n\nTransfer complete. ${characterCount} characters.\n`);
  }
  robot.follow(target)
}
export default {
  onRobotCreated,
  autoLoop: false
}
