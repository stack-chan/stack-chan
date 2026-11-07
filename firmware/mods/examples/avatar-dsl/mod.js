// SPDX-License-Identifier: Apache-2.0
import { createAvatarFace } from 'avatar-dsl/face'

let face
export function onContextCreated(robot) {
  const next = createAvatarFace({ preset: 'default' })
  robot.ui.setFace(next.content)
  const previous = face
  face = next
  previous?.dispose()
}
