import { pcmMagnitudeSum } from 'stackchan/voice/pcm-magnitude'

export const minimumOutputBytes = 4092
const DMA_BYTES = 4092
const DMA_COUNT = 6

export function openOutput(sampleRate, volume, limit, onLevel, diagnostic, startup) {
  if (sampleRate !== 16000 || limit < minimumOutputBytes) throw new RangeError('StopWatch audio requires 16 kHz')
  const now = diagnostic?.now
  const started = now?.()
  let firstWrite, lastWrite, firstSend, lastSend, creditWaitStart
  let inputBytes = 0,
    nativeBytes = 0,
    supplyGap = 0,
    sendGap = 0
  let waitTotal = 0,
    waitMax = 0,
    fullCredits = 0,
    maxCredit = 0
  const bytesPerMs = (sampleRate * 2) / 1000
  let playable = 0,
    sendCount = 0,
    gaps = 0,
    gapBytes = 0,
    maxGapBytes = 0,
    subTickGaps = 0
  let reporting = Boolean(diagnostic),
    reported = false
  const elapsed = (at) => (now() - at) >>> 0
  const report = (phase) => {
    if (!reporting || reported) return
    reported = true
    reporting = false
    const pendingWait = creditWaitStart === undefined ? 0 : elapsed(creditWaitStart)
    try {
      diagnostic.emit([
        phase,
        inputBytes,
        nativeBytes,
        firstWrite === undefined ? 0 : (firstWrite - started) >>> 0,
        firstSend === undefined ? 0 : (firstSend - started) >>> 0,
        elapsed(started),
        supplyGap,
        sendGap,
        waitTotal + pendingWait,
        Math.max(waitMax, pendingWait),
        fullCredits,
        maxCredit,
        stagedBytes,
      ])
    } catch {}
    try {
      diagnostic.emitSupply?.([
        phase,
        sendCount,
        gaps,
        Math.floor(gapBytes / bytesPerMs),
        Math.floor(maxGapBytes / bytesPerMs),
        subTickGaps,
        nativeBytes,
      ])
    } catch {}
  }
  if (startup && (limit < 4 * DMA_BYTES || !startup.setTimer || !startup.clearTimer))
    throw new RangeError('startup exceeds PCM budget or lacks timer')
  const staged = new Uint8Array(startup ? 3 * DMA_BYTES : DMA_BYTES)
  const primary = startup ? staged.subarray(0, DMA_BYTES) : staged
  let threshold = staged.length,
    startupTimer,
    flushTask,
    flushError
  let priming = Boolean(startup)
  let stagedBytes = 0
  let credit = 0,
    wake
  let driver,
    pending,
    closed = false,
    busy = false,
    frames = 0,
    drainTask
  const cancelled = () => Object.assign(new Error('audio closed'), { code: 'cancelled' })
  async function send(bytes) {
    let offset = 0
    while (offset < bytes.length) {
      if (closed) throw cancelled()
      if (!credit) {
        if (reporting) creditWaitStart = now()
        await new Promise((resolve, reject) => {
          wake = resolve
          pending = reject
        })
        if (reporting) {
          const waited = elapsed(creditWaitStart)
          waitTotal += waited
          waitMax = Math.max(waitMax, waited)
          creditWaitStart = undefined
        }
        continue
      }
      const count = Math.min(credit, bytes.length - offset) & ~1
      if (!count) throw new Error('unaligned speaker credit')
      driver.write(bytes.subarray(offset, offset + count))
      if (reporting) {
        const at = now()
        if (firstSend === undefined) {
          firstSend = at
          diagnostic.emitFirstSend?.(at)
        }
        if (lastSend !== undefined) sendGap = Math.max(sendGap, (at - lastSend) >>> 0)
        if (diagnostic.emitSupply) {
          sendCount++
          if (lastSend !== undefined) {
            const spent = ((at - lastSend) >>> 0) * bytesPerMs
            if (spent > playable) {
              const shortage = spent - playable
              // The millisecond clock cannot resolve a sub-two-ms edge reliably.
              if (shortage >= 2 * bytesPerMs) {
                gaps++
                gapBytes += shortage
                maxGapBytes = Math.max(maxGapBytes, shortage)
              } else subTickGaps++
              playable = 0
            } else playable -= spent
          }
          playable += count
        }
        lastSend = at
        nativeBytes += count
      }
      credit -= count
      offset += count
    }
  }
  async function submitAudio(bytes) {
    const level = onLevel && (pcmMagnitudeSum(bytes, 0, bytes.length) * volume) / (bytes.length * 16384)
    await send(bytes)
    if (!closed) onLevel?.(level)
  }
  function flushStage() {
    if (flushTask) return flushTask
    if (startupTimer !== undefined) startup.clearTimer(startupTimer)
    startupTimer = undefined
    priming = false
    threshold = DMA_BYTES
    const length = stagedBytes
    const task = (async () => {
      for (let at = 0; at < length; at += DMA_BYTES) {
        if (closed) throw cancelled()
        await submitAudio(staged.subarray(at, Math.min(length, at + DMA_BYTES)))
      }
      if (closed) throw cancelled()
      stagedBytes = 0
    })()
    flushTask = task
    void task.then(
      () => {
        if (flushTask === task) flushTask = undefined
      },
      (error) => {
        flushError = error
        if (flushTask === task) flushTask = undefined
      },
    )
    return task
  }
  try {
    driver = new device.audio.Output({
      sampleRate,
      channels: 1,
      bitsPerSample: 16,
      onWritable(bytes) {
        if (closed) return
        if (reporting) {
          maxCredit = Math.max(maxCredit, bytes)
          if (firstSend !== undefined && bytes >= DMA_BYTES * (DMA_COUNT - 1)) fullCredits++
        }
        credit = bytes
        const resume = wake
        wake = undefined
        pending = undefined
        resume?.()
      },
    })
    driver.volume = volume
    driver.start()
  } catch (error) {
    driver?.close()
    throw error
  }
  return {
    get frames() {
      return frames
    },
    setVolume(gain) {
      if (closed) throw cancelled()
      volume = Math.max(0, Math.min(1, gain))
      driver.volume = volume
    },
    async write(bytes, onAccepted) {
      if (closed) throw cancelled()
      if (busy || drainTask || bytes.byteLength & 1 || bytes.byteLength > limit)
        throw new RangeError('unaccepted StopWatch PCM')
      if (reporting && bytes.byteLength) {
        const at = now()
        firstWrite ??= at
        if (lastWrite !== undefined) supplyGap = Math.max(supplyGap, (at - lastWrite) >>> 0)
        lastWrite = at
        inputBytes += bytes.byteLength
      }
      busy = true
      try {
        if (flushTask) await flushTask
        if (flushError) throw flushError

        for (let offset = 0; offset < bytes.byteLength; ) {
          if (closed) throw cancelled()
          const count = Math.min(threshold - stagedBytes, bytes.byteLength - offset)
          const piece = bytes.subarray(offset, offset + count)
          if (priming && startupTimer === undefined)
            startupTimer = startup.setTimer(() => {
              flushStage()
            }, 500)
          staged.set(piece, stagedBytes)
          stagedBytes += count
          offset += count
          frames += count / 2
          onAccepted?.(count)
          // Coalesce decoder frames, then use all available native DMA credit
          // before waiting. The native ring is separate from this bounded stage.
          if (stagedBytes === threshold) {
            if (priming) await flushStage()
            else {
              await submitAudio(primary)
              stagedBytes = 0
            }
          }
        }
      } finally {
        busy = false
      }
    },
    drain() {
      if (busy) return Promise.reject(new Error('write still pending'))
      if (!drainTask)
        drainTask = (async () => {
          if (flushTask) await flushTask
          if (flushError) throw flushError
          if (priming) await flushStage()
          else if (stagedBytes) {
            await submitAudio(staged.subarray(0, stagedBytes))
            stagedBytes = 0
          }
          report(1)
          // Writable credit acknowledges DMA space, not playback. A full ring
          // of silence pushes preceding PCM past all six hardware descriptors.
          const quiet = primary
          quiet.fill(0)
          for (let i = 0; i < DMA_COUNT + 1; i++) await send(quiet)
        })()
      return drainTask
    },
    close() {
      if (closed) return
      report(2)
      closed = true
      if (startupTimer !== undefined) startup.clearTimer(startupTimer)
      startupTimer = undefined
      stagedBytes = 0
      const reject = pending
      pending = undefined
      wake = undefined
      try {
        driver.close()
      } finally {
        reject?.(cancelled())
      }
    },
  }
}
