import type { MotionCompletion, MotionResultCallback } from 'motion-controller'
import type { Maybe, Rotation } from 'stackchan-util'

export class NoneDriver {
  #rotation: Rotation = { y: 0.0, p: 0.0, r: 0.0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }

  setTorque(_torque: boolean, callback?: MotionCompletion): void {
    // do nothing
    callback?.()
  }

  applyRotation(_rotation: Rotation, _time?: number, callback?: MotionCompletion): void {
    // do nothing
    callback?.()
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    callback(this.#rotationResult)
  }
}
