// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import { createTransport } from 'realtimeConversation/transport-core'
import Timer from 'timer'

// Native classes and function literals must be declared in the platform module.
// Passing the Native factory through another function does not create a class in XS.
class NativeTransport extends Native('xs_live_transport_destructor') {}

const bindings = {
  xs_live_transport_constructor: native('xs_live_transport_constructor'),
  xs_live_transport_start: native('xs_live_transport_start'),
  xs_live_transport_answer: native('xs_live_transport_answer'),
  xs_live_transport_send: native('xs_live_transport_send'),
  xs_live_audio_quiesce: native('xs_live_audio_quiesce'),
  xs_live_transport_mute: native('xs_live_transport_mute'),
  xs_live_transport_volume: native('xs_live_transport_volume'),
  xs_live_transport_stats: native('xs_live_transport_stats'),
  xs_live_transport_diagnostics: native('xs_live_transport_diagnostics'),
  xs_live_transport_close: native('xs_live_transport_close'),
  xs_live_transport_read: native('xs_live_transport_read'),
  xs_live_transport_release: native('xs_live_transport_release'),
}

export default createTransport({ Timer, Base: NativeTransport, native: (name) => bindings[name], ArrayBuffer })
