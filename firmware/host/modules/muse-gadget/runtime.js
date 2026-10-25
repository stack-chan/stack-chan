export function createMuseDockRuntime(createSession, read, onClosed = () => {}) {
  let context
  let session
  let closed = false
  let generation = 0
  const runtime = {
    onContextCreated(value) {
      if (!closed) context = value
    },
    connect() {
      if (closed || !context) throw new Error('Muse dock is unavailable')
      const current = ++generation
      session?.close()
      session = createSession(
        { host: read('host'), vmId: read('vmId'), token: read('token'), nodeId: read('nodeId') },
        {
          onState(state) {
            if (!closed && current === generation) context?.ui.showBalloon(`Muse: ${state}`)
          },
          onText(text) {
            if (!closed && current === generation) context?.ui.showBalloon(text.slice(0, 256))
          },
          onSmile() {
            if (!closed && current === generation) context?.face.setEmotion(3)
          }, // HAPPY only.
        },
      )
      session.connect()
    },
    sendText(text) {
      if (closed || !session) throw new Error('Muse is disconnected')
      session.sendText(text)
    },
    disconnect() {
      generation++
      session?.close()
      session = undefined
    },
    close() {
      if (closed) return
      closed = true
      generation++
      session?.close()
      session = undefined
      context = undefined
      onClosed()
    },
  }
  return runtime
}
