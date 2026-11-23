export const setupActions = {
  pairing: { left: 64, width: 160, top: 255, height: 68 },
  connect: { left: 242, width: 160, top: 255, height: 68 },
  voice: { left: 140, width: 186, top: 350, height: 48 },
  provider: { left: 120, width: 226, top: 190, height: 48 },
}
export const savedStatusBounds = { left: 90, width: 286, top: 95, height: 84 }

export function voiceMenuAvailable(phase, ready, busy = false) {
  return phase === 'saved' && ready === true && !busy
}

export function createTalkFeedback() {
  let phase = 'idle',
    level = 0
  return {
    snapshot() {
      return { phase, level, recording: phase === 'recording', busy: phase !== 'idle' }
    },
    hold(value) {
      if (value) phase = 'recording'
      else if (phase === 'recording') phase = 'transcribing'
      level = 0
    },
    playback(active) {
      if (active) phase = 'speaking'
      else if (phase === 'speaking') phase = 'thinking'
      level = 0
    },
    event(event) {
      if (event.type === 'input.level') {
        level = phase === 'recording' && Number.isFinite(event.value) ? Math.max(0, Math.min(1, event.value)) : 0
        return
      }
      if (event.type === 'turn.started') phase = 'thinking'
      else if (event.type === 'input.transcript' && event.value.final && !event.value.text.trim()) phase = 'idle'
      else if (event.type === 'turn.ended' || event.type === 'session.ended' || event.type === 'error') phase = 'idle'
      else return
      level = 0
    },
    reset() {
      phase = 'idle'
      level = 0
    },
  }
}
