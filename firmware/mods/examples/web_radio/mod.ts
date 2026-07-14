/// <reference path="./types.d.ts" />

import type { StackchanContext, WebRadioState } from 'capabilities'
import { MusicNotes } from 'effects/music-notes'

const STREAM_URL = 'https://ice5.somafm.com/groovesalad-128-mp3'
const QUIET_VOLUME = 0.05
const EFFECT_KEY = 'web-radio:music-notes'
const DRAWER_KEY = 'web-radio:toggle'

const notes = new MusicNotes()
let requested = false
let starting: Promise<void> | undefined

function showNotes(context: StackchanContext): void {
  context.ui.addEffect(notes, EFFECT_KEY)
}

function hideNotes(context: StackchanContext): void {
  context.ui.removeEffect(notes)
}

function onRadioState(context: StackchanContext, state: WebRadioState, reason?: string): void {
  context.drawer.setDrawerButtonState(DRAWER_KEY, requested && state !== 'idle' && state !== 'error')
  if (state === 'playing') {
    context.hideBalloon()
    showNotes(context)
    return
  }
  hideNotes(context)
  if (state === 'error') {
    requested = false
    context.ui.setFaceMotionEnabled?.(true)
    context.drawer.setDrawerButtonState(DRAWER_KEY, false)
    context.showBalloon(`Radio error: ${reason ?? 'unknown error'}`)
  }
}

async function startRadio(context: StackchanContext): Promise<void> {
  if (starting) return starting
  const radio = context.audio.webRadio
  if (!radio) {
    requested = false
    context.drawer.setDrawerButtonState(DRAWER_KEY, false)
    context.showBalloon('WebRadio is not supported on this target.')
    return
  }
  requested = true
  context.ui.setFaceMotionEnabled?.(false)
  context.drawer.setDrawerButtonState(DRAWER_KEY, true)
  starting = radio
    .start({
      url: STREAM_URL,
      volume: QUIET_VOLUME,
      sampleRate: 44100,
      reconnect: true,
      onStateChanged: (state, reason) => onRadioState(context, state, reason),
    })
    .catch((error) => {
      requested = false
      context.ui.setFaceMotionEnabled?.(true)
      hideNotes(context)
      context.drawer.setDrawerButtonState(DRAWER_KEY, false)
      context.showBalloon(`Radio error: ${String(error)}`)
    })
    .finally(() => {
      starting = undefined
    })
  return starting
}

function stopRadio(context: StackchanContext): void {
  requested = false
  context.audio.webRadio?.stop()
  context.ui.setFaceMotionEnabled?.(true)
  hideNotes(context)
  context.drawer.setDrawerButtonState(DRAWER_KEY, false)
}

async function initialize(context: StackchanContext): Promise<void> {
  context.drawer.addDrawerButton({
    key: DRAWER_KEY,
    label: 'Radio',
    kind: 'toggle',
    initialState: false,
    callback: (nextContext) => {
      if (requested) stopRadio(nextContext)
      else void startRadio(nextContext)
    },
  })

  const network = context.connectivity.network
  if (!network) {
    context.showBalloon('Network is not available on this target.')
    return
  }
  const ready = await network.ready
  if (ready.status !== 'connected') {
    context.showBalloon(`Network unavailable: ${ready.reason}`)
    return
  }
  await startRadio(context)
}

export function onContextCreated(context: StackchanContext): void {
  void initialize(context)
}
