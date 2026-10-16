// SPDX-License-Identifier: Apache-2.0
import { Content, Template } from 'piu/MC'

function buffer(view) {
  if (!view?.buffer) return view
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) return view.buffer
  return new DataView(view.buffer, view.byteOffset, view.byteLength)
}

const prototype = {
  __proto__: Content.prototype,
  _create($, dictionary) {
    native('xs_avds_face_create').call(this, $, dictionary)
  },
  initialize(bytecode, fallback, context, safeContext, instructions = 12000, draws = 96, stateBreath = false) {
    native('xs_avds_face_initialize').call(
      this,
      bytecode,
      fallback,
      buffer(context),
      buffer(safeContext),
      instructions,
      draws,
      stateBreath,
    )
  },
  setContext(context) {
    native('xs_avds_face_context').call(this, buffer(context))
  },
  invalidate(x, y, width, height) {
    native('xs_avds_face_invalidate').call(this, x, y, width, height)
  },
  setMotionsEnabled(enabled) {
    native('xs_avds_face_motions').call(this, enabled)
  },
  pause() {
    native('xs_avds_face_pause').call(this, true)
  },
  resume() {
    native('xs_avds_face_pause').call(this, false)
  },
  close() {
    native('xs_avds_face_close').call(this)
  },
  snapshot(context, commands) {
    return native('xs_avds_face_snapshot').call(this, buffer(context), buffer(commands))
  },
  get stats() {
    return native('xs_avds_face_stats').call(this)
  },
  get failure() {
    return native('xs_avds_face_failure').call(this)
  },
}
export const NativeFace = Template(Object.freeze(prototype))
export function allocationStats() {
  return native('xs_avds_allocations').call(this)
}

// Diagnostic/oracle interface; production animation never calls this from JS.
export class NativeVM extends Native('xs_avds_vm_delete') {
  constructor(bytecode, instructions = 12000, draws = 96) {
    super()
    native('xs_avds_vm_create').call(this, bytecode, instructions, draws)
  }
  run(context, commands) {
    return native('xs_avds_vm_run').call(this, buffer(context), buffer(commands))
  }
  get steps() {
    return native('xs_avds_vm_steps').call(this)
  }
  get stats() {
    return native('xs_avds_vm_stats').call(this)
  }
  close() {
    native('xs_avds_vm_close').call(this)
  }
}
