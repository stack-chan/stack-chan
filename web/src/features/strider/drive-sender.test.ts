import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { DriveSender } from './drive-sender'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('a stop goes out after the one pending write and before a fresh press', async () => {
  let finishFirstWrite!: () => void
  const pendingWrite = new Promise<void>((resolve) => {
    finishFirstWrite = resolve
  })
  const broadcast = vi.fn().mockResolvedValue(undefined).mockReturnValueOnce(pendingWrite)
  const sender = new DriveSender({ broadcast }, vi.fn())

  expect(sender.start('forward', 0.6)).toBe(true)
  await vi.advanceTimersByTimeAsync(350)
  expect(broadcast).toHaveBeenCalledTimes(1)
  expect(broadcast).toHaveBeenLastCalledWith('drive', { action: 'forward', gesture: expect.any(Number), power: 0.6 })

  const stopping = sender.stop()
  expect(sender.start('backward', 0.4)).toBe(true)
  finishFirstWrite()
  await stopping
  expect(broadcast).toHaveBeenCalledTimes(2)
  expect(broadcast).toHaveBeenLastCalledWith('drive', { action: 'stop', gesture: expect.any(Number), power: 0.2 })

  await vi.advanceTimersByTimeAsync(250)
  const [, forward] = broadcast.mock.calls[0]
  const [, stop] = broadcast.mock.calls[1]
  const [, backward] = broadcast.mock.calls[2]
  expect(backward).toEqual({ action: 'backward', gesture: expect.any(Number), power: 0.4 })
  expect(stop.gesture).toBeGreaterThan(forward.gesture)
  expect(backward.gesture).toBeGreaterThan(stop.gesture)
  expect(broadcast.mock.calls[3]).toEqual(['drive', backward])

  const sentBeforeClose = broadcast.mock.calls.length
  sender.close()
  await vi.advanceTimersByTimeAsync(500)
  expect(broadcast).toHaveBeenCalledTimes(sentBeforeClose)
})

test('a failed write ends heartbeats and rejects further presses on the old connection', async () => {
  const broadcast = vi.fn().mockRejectedValue(new Error('GATT write failed'))
  const failed = vi.fn()
  const sender = new DriveSender({ broadcast }, failed)

  sender.start('forward', 0.6)
  await sender.stop()
  await vi.advanceTimersByTimeAsync(500)
  expect(failed).toHaveBeenCalledTimes(1)
  expect(broadcast).toHaveBeenCalledTimes(1)
  expect(sender.start('backward', 0.4)).toBe(false)
})
