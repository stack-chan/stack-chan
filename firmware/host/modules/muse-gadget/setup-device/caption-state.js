import { paginateCaption } from 'muse-caption-layout'

export function createCaptionState({ measure, timer, now, render }) {
  let epoch = 0,
    phase = 'idle',
    turn,
    output,
    prepared,
    heard,
    page = 0,
    ended,
    stoppedAt,
    pending,
    expiry,
    redraw
  let user = [],
    outputs = new Map()
  const retired = new Set()
  const clearTimer = (handle) => {
    if (handle !== undefined) timer.clear(handle)
  }
  const schedule = (callback, delay) => {
    const expected = epoch
    return timer.set(() => {
      if (epoch === expected && phase !== 'closed') callback()
    }, delay)
  }
  const publish = () => {
    if (redraw !== undefined) return
    redraw = schedule(() => {
      redraw = undefined
      const item = outputs.get(output)
      render({
        phase,
        speaker: phase === 'error' ? 'error' : item && phase === 'speaking' ? 'muse' : 'user',
        lines: phase === 'speaking' ? (item?.pages[page] ?? []) : user,
        waiting: phase === 'waiting' || phase === 'transcribing',
      })
    }, 0)
  }
  const reset = (next) => {
    epoch++
    for (const handle of [pending, expiry, redraw]) clearTimer(handle)
    for (const item of outputs.values()) clearTimer(item.layout)
    pending = expiry = redraw = undefined
    if (turn) retired.add(turn)
    if (retired.size > 32) retired.delete(retired.values().next().value)
    phase = next
    turn = output = prepared = heard = ended = stoppedAt = undefined
    page = 0
    user = []
    outputs = new Map()
    publish()
  }
  const advance = () => {
    const item = outputs.get(output)
    if (pending !== undefined || !item || stoppedAt !== undefined || page + 1 >= item.pages.length) return
    const weight = item.pages[page].join('').length
    const total = item.pages.reduce((sum, lines) => sum + lines.join('').length, 0)
    const delay = Math.max(700, weight * (item.duration > 0 ? item.duration / total : 90))
    pending = schedule(() => {
      pending = undefined
      page++
      publish()
      advance()
    }, delay)
  }
  const expire = () => {
    clearTimer(expiry)
    const expectedOutput = prepared,
      expectedStop = stoppedAt
    const finish = () => {
      if (prepared !== expectedOutput || stoppedAt !== expectedStop) return
      expiry = undefined
      if (ended !== undefined) reset('idle')
      else {
        phase = 'waiting'
        user = []
        output = prepared = heard = undefined
        publish()
      }
    }
    const elapsed = stoppedAt === undefined ? 0 : (now() - stoppedAt) >>> 0
    if (elapsed >= 2000) finish()
    else expiry = schedule(finish, 2000 - elapsed)
  }
  const api = {
    input(active) {
      if (phase === 'closed') return
      if (active) reset('recording')
      else if (phase === 'recording') {
        phase = 'transcribing'
        publish()
      }
    },
    transcript(text) {
      if (!['recording', 'transcribing'].includes(phase)) return
      if (!text.trim()) {
        api.error('音声を聞き取れませんでした。')
        return
      }
      user = paginateCaption(text, measure)[0] ?? []
      phase = 'waiting'
      publish()
    },
    event(event) {
      if (phase === 'closed') return
      if (event.type === 'turn.started') {
        if (retired.has(event.turnId) || phase === 'error') return
        if (turn && turn !== event.turnId) return
        turn = event.turnId
        phase = 'waiting'
        publish()
      } else if (event.type === 'caption.segment') {
        if (event.turnId !== turn || phase === 'error' || ended !== undefined) return
        let item = outputs.get(event.outputId)
        if (!item) {
          item = { text: '', pages: [] }
          outputs.set(event.outputId, item)
        }
        if (item.stopped) return
        item.text += event.text
        if (item.layout !== undefined) return
        item.layout = schedule(() => {
          item.layout = undefined
          if (item.stopped) return
          item.pages = paginateCaption(item.text, measure)
          if (heard !== event.outputId) return
          if (output === heard && phase === 'speaking') {
            publish()
            advance()
          } else api.audible()
        }, 0)
      } else if (event.type === 'caption.duration') {
        const item = outputs.get(event.outputId)
        if (event.turnId !== turn || !item) return
        item.duration = event.durationMs
      } else if (event.type === 'turn.ended' && event.turnId === turn) {
        if (event.status !== 'completed') {
          reset('idle')
          return
        }
        ended = now()
        expire()
      } else if (event.type === 'session.ended') reset('idle')
    },
    prepare(id, turnId = turn) {
      if (
        turnId !== turn ||
        !turn ||
        outputs.get(id)?.stopped ||
        phase === 'closed' ||
        phase === 'error' ||
        ended !== undefined
      )
        return false
      clearTimer(pending)
      clearTimer(expiry)
      pending = undefined
      expiry = undefined
      prepared = id
      heard = stoppedAt = undefined
      return true
    },
    audible() {
      heard = prepared
      const item = outputs.get(prepared)
      if (
        !item?.pages.length ||
        (phase === 'speaking' && output === prepared) ||
        stoppedAt !== undefined ||
        ended !== undefined ||
        phase === 'closed' ||
        phase === 'error'
      )
        return
      output = prepared
      page = 0
      phase = 'speaking'
      publish()
      advance()
    },
    stopOutput(info) {
      if (!info || info.turnId !== turn || info.outputId !== prepared || phase === 'closed') return false
      clearTimer(pending)
      pending = undefined
      const item = outputs.get(info.outputId)
      if (item) item.stopped = true
      if (stoppedAt === undefined) stoppedAt = now()
      expire()
      return true
    },
    error(message) {
      if (phase === 'closed') return
      reset('error')
      user = paginateCaption(message, measure)[0] ?? []
      publish()
    },
    clear() {
      if (phase !== 'closed') reset('idle')
    },
    close() {
      reset('closed')
      clearTimer(redraw)
      redraw = undefined
      render({ phase: 'closed', lines: [], waiting: false })
    },
  }
  return api
}
