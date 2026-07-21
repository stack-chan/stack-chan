/// <reference path="./types.d.ts" />

import type { StackchanContext, WebRadioState } from 'capabilities'
import { MusicNotes } from 'effects/music-notes'

const RADIO_VOLUME = 0.2
const EFFECT_KEY = 'web-radio:music-notes'
const DRAWER_KEY = 'web-radio:station'
const OFF_VALUE = 'off'
const STATIONS = [
  { value: 'groovesalad', label: 'Groove Salad', url: 'http://ice2.somafm.com/groovesalad-128-mp3' },
  { value: 'dronezone', label: 'Drone Zone', url: 'http://ice2.somafm.com/dronezone-128-mp3' },
  { value: 'deepspaceone', label: 'Deep Space One', url: 'http://ice2.somafm.com/deepspaceone-128-mp3' },
  { value: 'spacestation', label: 'Space Station Soma', url: 'http://ice2.somafm.com/spacestation-128-mp3' },
  { value: 'secretagent', label: 'Secret Agent', url: 'http://ice2.somafm.com/secretagent-128-mp3' },
  { value: 'beatblender', label: 'Beat Blender', url: 'http://ice2.somafm.com/beatblender-128-mp3' },
  { value: 'indiepop', label: 'Indie Pop Rocks!', url: 'http://ice2.somafm.com/indiepop-128-mp3' },
  { value: 'radioparadise', label: 'Radio Paradise', url: 'http://stream-tx1.radioparadise.com/mp3-128' },
] as const
const DEFAULT_STATION = STATIONS[0].value
const DRAWER_OPTIONS = [
  { value: OFF_VALUE, label: 'ラジオ停止' },
  ...STATIONS.map(({ value, label }) => ({ value, label })),
]

const notes = new MusicNotes()
let selectedValue: string = DEFAULT_STATION

function showNotes(context: StackchanContext): void {
  context.ui.addEffect(notes, EFFECT_KEY)
}

function hideNotes(context: StackchanContext): void {
  context.ui.removeEffect(notes)
}

function setConnectionIndicator(context: StackchanContext, visible: boolean): void {
  context.ui.application?.distribute?.('onConnectionIndicator', visible)
}

function onRadioState(context: StackchanContext, value: string, state: WebRadioState, reason?: string): void {
  if (value !== selectedValue) return
  setConnectionIndicator(
    context,
    state === 'connecting' || state === 'buffering' || state === 'stalled' || state === 'retrying',
  )
  if (state === 'playing') {
    context.hideBalloon()
    showNotes(context)
    return
  }
  hideNotes(context)
  if (state === 'error') {
    context.ui.setFaceMotionEnabled?.(true)
    context.showBalloon(`Radio error: ${reason ?? 'unknown error'}`)
  }
}

function selectStation(context: StackchanContext, value: string): void {
  const station = STATIONS.find((candidate) => candidate.value === value)
  if (value !== OFF_VALUE && !station) return
  selectedValue = value
  setConnectionIndicator(context, false)
  const radio = context.audio.webRadio
  radio?.stop()
  hideNotes(context)
  context.hideBalloon()
  if (!station) {
    context.ui.setFaceMotionEnabled?.(true)
    return
  }
  if (!radio) {
    context.ui.setFaceMotionEnabled?.(true)
    context.showBalloon('WebRadio is not supported on this target.')
    return
  }
  context.ui.setFaceMotionEnabled?.(false)
  void radio
    .start({
      url: station.url,
      volume: RADIO_VOLUME,
      sampleRate: 44100,
      reconnect: true,
      onStateChanged: (state, reason) => onRadioState(context, station.value, state, reason),
    })
    .catch((error) => {
      if (selectedValue !== station.value) return
      setConnectionIndicator(context, false)
      context.ui.setFaceMotionEnabled?.(true)
      hideNotes(context)
      context.showBalloon(`Radio error: ${String(error)}`)
    })
}

async function initialize(context: StackchanContext): Promise<void> {
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
  context.drawer.addDrawerButton({
    key: DRAWER_KEY,
    label: 'ラジオ',
    kind: 'choice',
    value: selectedValue,
    options: DRAWER_OPTIONS,
    callback: (nextContext, value) => {
      if (value) selectStation(nextContext, value)
    },
  })
  selectStation(context, selectedValue)
}

export function onContextCreated(context: StackchanContext): void {
  void initialize(context)
}
