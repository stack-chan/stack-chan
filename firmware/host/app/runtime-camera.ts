import type { RobotCamera } from 'camera'

const NULL_CAMERA: RobotCamera = {
  start() {},
  stop() {},
  async capture() {
    return undefined
  },
}

export type RuntimeCameraConstructorParam = {
  camera?: RobotCamera
}

export class StackchanRuntimeCamera {
  #camera: RobotCamera

  constructor(params: RuntimeCameraConstructorParam) {
    this.#camera = params.camera ?? NULL_CAMERA
  }

  get camera(): RobotCamera {
    return this.#camera
  }
}
