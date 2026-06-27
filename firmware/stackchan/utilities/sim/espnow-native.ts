function start(_channel: number): void {}

function read(): ArrayBuffer | undefined {
  return undefined
}

function send(_data: ArrayBuffer): void {}

function close(): void {}

export default { start, read, send, close }
