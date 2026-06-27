function start(channel: number): void {
  native('xs_stackchan_espnow_start').call(this, channel)
}

function read(): ArrayBuffer | undefined {
  return native('xs_stackchan_espnow_read').call(this)
}

function send(data: ArrayBuffer): void {
  native('xs_stackchan_espnow_send').call(this, data)
}

function close(): void {
  native('xs_stackchan_espnow_close').call(this)
}

export default { start, read, send, close }
