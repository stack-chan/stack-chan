import type { RobotCamera } from 'camera'
import type { TTS, WebRadioCapability } from 'capabilities'
import type { MotionDriver } from 'motion-controller'
import { ResourceScope } from 'owned-resources'
import { StackchanError } from 'stackchan/errors'

/** Device ownership exists before any runtime is initialized. Each child may also
 * be closed by its runtime; the shared completion prevents a second device close. */
export class RuntimeResources extends ResourceScope {
  readonly ui = this.own(new ResourceScope())
  readonly motion = this.own(new ResourceScope())
  readonly audio = this.own(new ResourceScope())
  readonly input = this.own(new ResourceScope())
  readonly camera = this.own(new ResourceScope())
  readonly lighting = this.own(new ResourceScope())
}

export function ownUI<T extends { close?(): void | Promise<void> }>(scope: ResourceScope, ui: T): T {
  scope.defer(() => ui.close?.())
  return ui
}

export function ownMotionDriver<T extends MotionDriver>(scope: ResourceScope, driver: T): T {
  scope.defer(() => driver.close?.())
  return driver
}

export function ownTTS<T extends TTS>(scope: ResourceScope, tts: T): T {
  scope.defer(() => {
    if (tts.close) return tts.close()
    return tts.cancelPlayback?.(new StackchanError('CLOSED', 'Audio is closed'))
  })
  return tts
}

export function ownMicrophone<T extends { stop(): void | Promise<void>; close?(): void | Promise<void> }>(
  scope: ResourceScope,
  microphone: T,
): T {
  scope.defer(() => {
    if (microphone.close) return microphone.close()
    return microphone.stop()
  })
  return microphone
}

export function ownWebRadio<T extends WebRadioCapability>(scope: ResourceScope, radio: T): T {
  scope.defer(() => radio.stop())
  return radio
}

export function ownCamera<T extends RobotCamera>(scope: ResourceScope, camera: T): T {
  scope.defer(() => camera.close?.())
  return camera
}

export function ownLed<T extends { off(): void; close?(): void | Promise<void> }>(scope: ResourceScope, led: T): T {
  scope.defer(() => {
    if (led.close) return led.close()
    led.off()
  })
  return led
}
