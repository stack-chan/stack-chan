import type { StackchanError } from 'stackchan/errors'

/** Cooperative cancellation. Listeners release their operation's resources. */
export interface CancellationSignal {
  readonly reason: StackchanError | undefined
  throwIfCancelled(): void
  subscribe(listener: (reason: StackchanError) => void): () => void
}

export type OperationOptions = { signal?: CancellationSignal }
export type TaskContext = {
  readonly signal: CancellationSignal
  sleep(durationMs: number): Promise<void>
}
export type TaskHandler = (task: TaskContext) => void | Promise<void>
export type Unsubscribe = () => void
