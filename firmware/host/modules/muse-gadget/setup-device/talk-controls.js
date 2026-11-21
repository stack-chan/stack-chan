export function createTalkControls({ canTalk, setMuted, disconnect, onHeld, onError }) {
  let owner, start, generation = 0, stopping, closed = false
  return {
    press(source) {
      if (closed || stopping || owner || !canTalk()) return false
      owner = source
      const current = ++generation
      onHeld(true)
      start = Promise.resolve().then(() => {
        if (closed || current !== generation) return
        return setMuted(false)
      }).catch(() => {
        if (current !== generation) return
        generation++
        owner = start = stopping = undefined
        onHeld(false)
        onError('start')
      })
      return true
    },
    release(source) {
      if (closed || owner !== source) return
      owner = undefined
      const current = generation
      onHeld(false)
      const pending = start
      start = undefined
      stopping = Promise.resolve(pending).then(() => {
        if (closed || current !== generation || !canTalk()) return
        return setMuted(true)
      }).catch(() => {
        if (current === generation) onError('stop')
      }).finally(() => {
        if (current === generation) stopping = undefined
      })
      return stopping
    },
    disconnect() {
      if (closed || stopping === 'disconnect' || !canTalk()) return
      const current = ++generation
      owner = start = undefined
      stopping = 'disconnect'
      onHeld(false)
      return Promise.resolve().then(disconnect).catch(() => onError('disconnect')).finally(() => {
        if (current === generation) stopping = undefined
      })
    },
    reset() {
      generation++
      owner = start = stopping = undefined
      onHeld(false)
    },
    close() {
      closed = true
      this.reset()
    },
  }
}

export function attachTalkButtons({ A, B }, controls) {
  let a, b, aDown = false, bDown = false
  try {
    a = new A({ onPush() {
      const pressed = Boolean(this.pressed)
      if (pressed === aDown) return
      aDown = pressed
      if (pressed) controls.press('button-a')
      else controls.release('button-a')
    } })
    b = new B({ onPush() {
      const pressed = Boolean(this.pressed)
      if (pressed === bDown) return
      bDown = pressed
      if (pressed) controls.disconnect()
    } })
    const startupBPressed = Boolean(b.pressed)
    bDown = startupBPressed
    return { startupBPressed, close() { a.close(); b.close() } }
  } catch (error) {
    a?.close()
    b?.close()
    throw error
  }
}
