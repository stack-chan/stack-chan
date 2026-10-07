// SPDX-License-Identifier: Apache-2.0
import { createAvatarFace } from 'avatar-dsl/face'

let face
export function onContextCreated(robot) {
  face?.dispose()
  face = createAvatarFace({ preset: 'default' })
  robot.ui.setFace(face.content)
}
