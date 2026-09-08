import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type { StackchanError } from 'stackchan/errors'
import type { OperationOptions } from 'stackchan/task'

/** Host-facing device contracts shared by native implementations, WASM and injected tests. */
export interface AudioInputPort {
  monitor?(onLevel: (level: number) => void): void
  readonly available?: boolean
  readonly releaseFailure?: StackchanError
  record(durationMs?: number, options?: OperationOptions): Promise<OwnedAudioBuffer>
  stop(reason?: StackchanError): void | Promise<void>
  close?(): void | Promise<void>
}

export interface AudioOutputPort {
  available?(): boolean
  tone(hz: number, durationMs: number, volume?: number): Promise<void>
  play(buffer: BorrowedAudioBuffer, volume?: number): Promise<boolean>
  cancelPlayback?(reason?: unknown): void | Promise<void>
  close?(): void | Promise<void>
}
