function invalid() {
  throw Object.assign(new Error('Invalid Muse chat response'), { code: 'provider_failed' })
}

function id(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined
}

function finalText(payload, messageId) {
  for (const key of ['display_text', 'transcript', 'content']) {
    if (typeof payload[key] === 'string') return payload[key]
  }
  const messages = payload.transcript?.messages
  if (!Array.isArray(messages)) return undefined
  const message = messages.find((item) => item.role === 'assistant' && item.id === messageId)
  if (!Array.isArray(message?.content)) return undefined
  return message.content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
}

// A dedicated side chat is required; shared-chat parentless events are never accepted.
export class MuseChatTurn {
  constructor(sessionId, retired = []) {
    if (!id(sessionId)) invalid()
    this.sessionId = sessionId
    this.retired = retired
    this.pending = []
    this.replies = []
    this.tasks = []
    this.observed = []
    this.ignored = []
    this.sequence = { row: 0, live: 0 }
    this.lastActivity = 0
    this.finished = false
  }

  acknowledge(response, now) {
    const value = response?.result ?? response
    if (value?.session_id !== this.sessionId || value?.is_thread !== true) invalid()
    this.userIds = [value.message_id, value.reply_to_message_id].filter((value) => id(value))
    if (!this.userIds.length) invalid()
    this.lastActivity = now
    const pending = this.pending
    this.pending = []
    for (const event of pending) this.feed(event, now)
  }

  feed(event, now) {
    const p = event?.payload
    if (event?.type !== 'event' || !p || (p.session_id ?? event.session_id) !== this.sessionId) return
    if (
      ![
        'agent.status',
        'task.status',
        'delta.message_start',
        'delta.text_append',
        'delta.message_done',
        'message.assistant',
      ].includes(event.event)
    )
      return
    if (this.retired.includes(id(p.message_id ?? p.id ?? event.message_id)) || this.retired.includes(id(p.task_id)))
      return
    if (!this.userIds) {
      if (this.pending.length >= 32 || JSON.stringify([...this.pending, event]).length > 16384) invalid()
      this.pending.push(event)
      return
    }
    const messageId = id(p.message_id ?? p.id ?? event.message_id)
    const parent = id(p.reply_to_message_id ?? p.parent_message_id)
    const taskId = id(p.task_id)
    if (
      this.retired.includes(messageId) ||
      this.retired.includes(taskId) ||
      (this.retired.includes(parent) && !this.userIds.includes(parent))
    )
      return
    const row = event.event === 'message.assistant' || event.event === 'message.user'
    const bucket = row ? 'row' : 'live'
    if (Number.isSafeInteger(event.seq) && event.seq > 0) {
      if (event.seq <= this.sequence[bucket]) return
      this.sequence[bucket] = event.seq
    }
    for (const value of [messageId, taskId, parent]) {
      if (value && !this.observed.includes(value)) this.observed.push(value)
    }
    if (this.observed.length > 128) invalid()
    if (event.event === 'agent.status') {
      if (this.finished) return
      const activity = p.activity_code ?? p.status
      if (typeof activity === 'string')
        this.busy = !['', 'online', 'idle', 'completed', 'failed', 'cancelled', 'canceled'].includes(activity)
      this.lastActivity = now
      return
    }
    if (event.event === 'task.status') {
      if (!taskId) return
      const state = p.status
      const terminal = ['completed', 'failed', 'errored', 'cancelled', 'canceled'].includes(state)
      if (
        terminal &&
        !this.tasks.includes(taskId) &&
        !this.userIds.includes(parent) &&
        !this.replies.some((entry) => entry.id === parent || entry.id === messageId)
      )
        return
      this.tasks = this.tasks.filter((entry) => entry !== taskId)
      if (!terminal) {
        this.tasks.push(taskId)
        this.finished = false
      } else {
        this.finished = this.tasks.length === 0
        if (this.finished) this.busy = false
        if (state !== 'completed') this.failed = true
      }
      this.lastActivity = now
      return
    }
    if (
      !['delta.message_start', 'delta.text_append', 'delta.message_done', 'message.assistant'].includes(event.event) ||
      !messageId
    )
      return
    if (p.role === 'user' || this.ignored.includes(messageId)) return
    if (
      parent &&
      parent !== messageId &&
      !this.userIds.includes(parent) &&
      !this.replies.some((entry) => entry.id === parent)
    ) {
      this.ignored.push(messageId)
      return
    }
    let reply = this.replies.find((entry) => entry.id === messageId)
    if (!reply) {
      if (this.replies.length >= 16) invalid()
      reply = { id: messageId, text: '', done: false }
      this.replies.push(reply)
    }
    if (event.event === 'delta.text_append' && !reply.done && typeof p.text === 'string') reply.text += p.text
    if (event.event === 'delta.message_done' || event.event === 'message.assistant') {
      const text = finalText(p, messageId)
      if (text !== undefined) reply.text = text
      reply.done = event.event === 'delta.message_done' || p.display_text_ready !== false
    }
    if (this.replies.reduce((size, entry) => size + entry.text.length, 0) > 32768) invalid()
    this.lastActivity = now
  }

  complete(now) {
    if (!this.userIds || this.busy || this.tasks.length || this.replies.some((reply) => !reply.done)) return false
    if (this.finished) return now - this.lastActivity >= 1000
    return this.replies.length > 0 && now - this.lastActivity >= 3000
  }

  result() {
    return {
      status: this.failed ? 'incomplete' : 'completed',
      messages: this.replies.map((reply) => ({ ...reply })),
      text: this.replies
        .map((reply) => reply.text)
        .filter(Boolean)
        .join('\n\n'),
    }
  }
}
