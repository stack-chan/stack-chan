import TextDecoder from 'text/decoder'

/**
 * @brief face tracking mod with UnitV2
 * @param {*} robot
 */
function onRobotCreated(robot, device) {
  const decoder = new TextDecoder()
  const target = {
    x: 0.8,
    y: 0,
    z: 0,
  }
  const client = new device.network.http.io({
    ...device.network.http,
    host: 'unitv2.local',
    port: 80,
  })
  let request = client.request({
    method: 'POST',
    path: '/func/result',
    onReadable(count) {
      let result
      try {
        const text = decoder.decode(this.read(count))
        result = JSON.parse(text.split('|')[0])
      } catch (e) {
        trace('parse failed.\n')
        return
      }
      const face = result.face?.[0]
      if (face == null) {
        trace('no face detected.\n')
        return
      }

      let centerX = face.x + face.w / 2
      let centerY = face.y + face.h / 2
      target.y = 0.8 * ((320 - centerX) / 320)
      target.z = centerY / 480
      robot.lookAt([target.x, target.y, target.z])
    },
  })
}

export default {
  onRobotCreated,
}
