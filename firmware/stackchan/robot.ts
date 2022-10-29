import Timer from 'timer'
import config from 'mc/config'
import TTS_REMOTE from 'tts-remote'
import TTS_LOCAL from 'tts-local'
import { Vector3, Pose, Rotation } from 'stackchan-util'
import { defaultFaceContext, Renderer } from 'face-renderer'
import structuredClone from 'structuredClone'

const INTERVAL = 30

type Driver = {
  applyRotation: (ori: Rotation) => Promise<unknown>
  getRotation: () => Promise<Rotation>
}

type RobotConstructorParam = {
  driver: Driver
  renderer: Renderer
  pose?: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
}

export class Robot {
  _gazePoint: Vector3
  _pose: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  _driver: Driver
  _isMoving: boolean
  _renderer: Renderer
  constructor(params: RobotConstructorParam) {
    this._renderer = params.renderer
    this._driver = params.driver
    this._isMoving = false
    this._pose = params.pose ?? {
      body: {
        position: {
          x: 0.0,
          y: 0.0,
          z: 0.0,
        },
        rotation: {
          y: 0.0,
          p: 0.0,
          r: 0.0,
        },
      },
      eyes: {
        left: {
          position: {
            x: 0.03,
            y: 0.009,
            z: 0,
          },
          rotation: {
            r: 0.0,
            p: 0.0,
            y: 0.0,
          },
        },
        right: {
          position: {
            x: 0.03,
            y: -0.009,
            z: 0,
          },
          rotation: {
            r: 0.0,
            p: 0.0,
            y: 0.0,
          },
        },
      },
    }
    Timer.repeat(this.tick.bind(this), INTERVAL)
  }
  async speak(string) {
    const promise = config?.tts?.driver == 'remote' ? TTS_REMOTE.speak(string) : TTS_LOCAL.speak(string)
    promise.then(
      (bytes) => {
        return bytes
      },
      (error) => {
        return error
      }
    )
    return promise
  }
  lookAt(position: Vector3) {
    this._gazePoint = position
    /* noop */
  }
  lookAway() {
    this._gazePoint = null
  }
  updateFace() {
    const face = structuredClone(defaultFaceContext)
    if (this._gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this._gazePoint, {
        r: 0.0,
        y: -this._pose.body.rotation.y,
        p: -this._pose.body.rotation.p,
      })
      for (let key of ['left', 'right']) {
        const relative = Vector3.sub(relativeGazePoint, this._pose.eyes[key].position)
        const { y, p } = Rotation.fromVector3(relative)
        face.eyes[key] = {
          ...face.eyes[key],
          gazeX: Math.cos(y),
          gazeY: Math.cos(p),
        }
      }
    }
    this._renderer.render(face)
  }
  async tick() {
    this._pose.body.rotation = await this._driver.getRotation()
    this.updateFace()

    if (!this._isMoving && this._gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this._gazePoint, {
        r: 0.0,
        y: -this._pose.body.rotation.y,
        p: -this._pose.body.rotation.p,
      })
      const { y, p } = Rotation.fromVector3(relativeGazePoint)
      if (y > Math.PI / 6 || y < -Math.PI / 6 || p > Math.PI / 6 || p < -Math.PI / 6) {
        this._isMoving = true
        await this._driver.applyRotation(Rotation.fromVector3(this._gazePoint))
        this._isMoving = false
      }
    }
  }
}
