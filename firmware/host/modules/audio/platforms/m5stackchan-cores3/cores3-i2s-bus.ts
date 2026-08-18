export type CoreS3I2SRole = 'speaker' | 'microphone'
export type CoreS3I2SOwner = 'idle' | CoreS3I2SRole

export type CoreS3I2SCodec = {
  startSpeaker?(sampleRate: number): void
  stopSpeaker?(): void
  startMicrophone?(sampleRate: number): void
  stopMicrophone?(): void
}

export class CoreS3I2SBus {
  #owner: CoreS3I2SOwner = 'idle'
  #codec: CoreS3I2SCodec

  constructor(codec: CoreS3I2SCodec = {}) {
    this.#codec = codec
  }

  get owner(): CoreS3I2SOwner {
    return this.#owner
  }

  acquire(role: CoreS3I2SRole, sampleRate?: number): void {
    if (this.#owner === role) {
      this.#start(role, sampleRate)
      return
    }
    this.#stop(this.#owner)
    this.#owner = 'idle'
    this.#start(role, sampleRate)
    this.#owner = role
  }

  release(role: CoreS3I2SRole): void {
    if (this.#owner !== role) return
    this.#stop(role)
    this.#owner = 'idle'
  }

  #start(role: CoreS3I2SRole, sampleRate?: number): void {
    if (role === 'speaker') this.#codec.startSpeaker?.(sampleRate ?? 24000)
    else this.#codec.startMicrophone?.(sampleRate ?? 16000)
  }

  #stop(owner: CoreS3I2SOwner): void {
    if (owner === 'speaker') this.#codec.stopSpeaker?.()
    else if (owner === 'microphone') this.#codec.stopMicrophone?.()
  }
}

function startSpeaker(sampleRate: number): void {
  const amp = globalThis.amp as { sampleRate?: number } | undefined
  if (amp) amp.sampleRate = sampleRate
  writeAmpSysCtrl(0x4040)
}

function stopSpeaker(): void {
  writeAmpSysCtrl(0x0040)
}

function startMicrophone(_sampleRate: number): void {
  const mic = globalThis.mic as { init?: () => void } | undefined
  mic?.init?.()
}

function stopMicrophone(): void {
  writeMicReset()
}

function writeAmpSysCtrl(value: number): void {
  const io = openInternalSMBus(0x36)
  io?.writeUint16?.(0x04, value, true)
}

function writeMicReset(): void {
  const io = openInternalSMBus(0x40)
  io?.writeUint8?.(0x00, 0xff)
}

function openInternalSMBus(
  address: number,
):
  | {
      writeUint16?(register: number, value: number, littleEndian?: boolean): void
      writeUint8?(register: number, value: number): void
    }
  | undefined {
  const device = globalThis.device as
    | {
        io?: { SMBus?: new (options: Record<string, unknown>) => object }
        I2C?: { internal?: Record<string, unknown> }
      }
    | undefined
  const Bus = device?.io?.SMBus
  const internal = device?.I2C?.internal
  if (!Bus || !internal) return undefined
  try {
    return new Bus({ hz: 400_000, address, ...internal })
  } catch {
    return undefined
  }
}

export const cores3I2SBus = new CoreS3I2SBus({
  startSpeaker,
  stopSpeaker,
  startMicrophone,
  stopMicrophone,
})
