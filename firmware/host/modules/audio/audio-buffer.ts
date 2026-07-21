declare const audioBufferBorrowed: unique symbol
declare const audioBufferOwned: unique symbol

export type BorrowedAudioBuffer = ArrayBuffer & {
  readonly [audioBufferBorrowed]?: true
}

export type OwnedAudioBuffer = BorrowedAudioBuffer & {
  readonly [audioBufferOwned]: true
}

export function ownAudioBuffer(buffer: ArrayBuffer): OwnedAudioBuffer {
  return buffer as OwnedAudioBuffer
}
