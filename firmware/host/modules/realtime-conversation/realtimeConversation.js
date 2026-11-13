// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import { borrowLiveAudio, liveAudioRequirements } from 'realtimeConversation/audioLease'
import Protocol from 'realtimeConversation/core'
import fetch from 'realtimeConversation/http'
import { liveConversation } from 'realtimeConversation/session'
import Transport from 'realtimeConversation/transport'
import { createVoiceScope } from 'stackchan/voice/scope'
import Timer from 'timer'

function createLiveConversation(options) {
  return liveConversation(options, {
    audio: liveAudioRequirements,
    createVoiceScope,
    borrowLiveAudio,
    setTimer: (fn, ms) => Timer.set(fn, ms),
    clearTimer: (timer) => Timer.clear(timer),
    createProtocol: (settings, lease) =>
      new Protocol(settings, {
        createTransport: (callback) => new Transport(callback, lease),
        fetch,
        setTimeout: (fn, ms) => Timer.set(fn, ms),
        clearTimeout: (timer) => Timer.clear(timer),
      }),
  })
}

export const LiveConversation = { create: createLiveConversation }
