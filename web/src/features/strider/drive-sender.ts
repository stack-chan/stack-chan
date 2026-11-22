export type DriveAction = 'forward' | 'backward' | 'left' | 'right' | 'calibrate'

type DriveCommand = {
  action: DriveAction | 'stop'
  gesture: number
  power: number
}

type DriveSession = {
  broadcast: (type: string, payload: DriveCommand) => Promise<unknown>
}

const SEND_INTERVAL = 100

export class DriveSender {
  #command?: DriveCommand
  #inFlight?: Promise<void>
  #stopping?: Promise<void>
  #closed = false
  #gesture = Date.now()
  #heartbeat: ReturnType<typeof setInterval>

  constructor(
    private readonly session: DriveSession,
    private readonly onFailure: () => void
  ) {
    this.#heartbeat = setInterval(() => this.#sendHeartbeat(), SEND_INTERVAL)
  }

  start(action: DriveAction, power: number) {
    if (this.#closed || this.#command) return false
    this.#command = this.#nextCommand(action, power)
    this.#sendHeartbeat()
    return true
  }

  stop(): Promise<void> {
    this.#command = undefined
    if (this.#closed) return Promise.resolve()
    if (!this.#stopping) {
      const stop = this.#nextCommand('stop', 0.2)
      this.#stopping = Promise.resolve(this.#inFlight)
        .then(() => this.#send(stop))
        .finally(() => {
          this.#stopping = undefined
        })
    }
    return this.#stopping
  }

  stopForPeerState(state: { status: string; reason?: string; gesture?: number }): Promise<void> | undefined {
    const command = this.#command
    if (!command) return
    if (state.status === 'error' && state.reason === 'stop-failed') return this.stop()
    if (state.gesture !== command.gesture) return
    if (
      state.status === 'error' ||
      (command.action === 'calibrate' && (state.status === 'calibrated' || state.status === 'needs-calibration'))
    ) {
      return this.stop()
    }
  }

  close() {
    this.#closed = true
    this.#command = undefined
    clearInterval(this.#heartbeat)
  }

  #nextCommand(action: DriveCommand['action'], power: number): DriveCommand {
    this.#gesture = Math.max(this.#gesture + 1, Date.now())
    return { action, gesture: this.#gesture, power }
  }

  #sendHeartbeat() {
    if (this.#closed || this.#stopping || this.#inFlight || !this.#command) return
    void this.#send(this.#command)
  }

  #send(command: DriveCommand): Promise<void> {
    if (this.#closed) return Promise.resolve()
    this.#inFlight = this.session
      .broadcast('drive', command)
      .then(() => undefined)
      .catch(() => {
        if (!this.#closed) {
          this.close()
          this.onFailure()
        }
      })
      .finally(() => {
        this.#inFlight = undefined
      })
    return this.#inFlight
  }
}
