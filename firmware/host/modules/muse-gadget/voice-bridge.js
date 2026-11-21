export function classifyMuseFailureBody(value) {
  if (typeof value !== 'string' || !value.length) return 'empty'
  if (/cannot post \/voice\/realtime|route.{0,40}not found|^404 page not found/i.test(value)) return 'route'
  if (/device.{0,40}not found|unknown device/i.test(value)) return 'device'
  if (/app.{0,40}not found|unknown app/i.test(value)) return 'app'
  if (/not[ _-]?found/i.test(value)) return 'not_found'
  return 'other'
}

const MEDIA = 1
const END = 3
const FORMAT = { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }
const BUDGET = { maxBufferedMs: 250, maxBufferedBytes: 8000 }
const MAX_PCM = 16000
const MAX_LINE = 32768
const error = (code) => Object.assign(new Error(code), { code })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

export function createMuseVoiceBridge(configuration, dependencies) {
  return {
    async open({ media, signal, onEvent }) {
      const d = dependencies
      if (signal.aborted) throw error('cancelled')
      const diagnostic = (value) => {
        try {
          d.onDiagnostic?.(value)
        } catch {}
      }
      const id = d.callId()
      diagnostic('bridge_core_create')
      const core = d.createCore()
      const ready = deferred()
      const ended = deferred()
      const drainLimit = deferred()
      let native, tick, deadline, inputLink, outputLink, producer
      let handshaking = true,
        admitted = false,
        live = false,
        stopped = false,
        finishing = false,
        tearingDown = false
      let enabled = false,
        held = false,
        generation = 0,
        outputId
      let closeMode,
        timedOut = false,
        confirmed = false,
        endStatus = 0
      let rx = new Uint8Array(MAX_LINE),
        rxSize = 0
      let microphone = new Uint8Array(6400),
        micSize = 0,
        nextSend = 0
      const quiet = new Uint8Array(640)
      let quietNext = 0
      let flushing = 0,
        inputRevision = 0,
        flushTask = Promise.resolve()
      let pending = [],
        pendingBytes = 0,
        waiting = [],
        waitingBytes = 0
      let pumping = false,
        pumpTask = Promise.resolve(),
        speakerUntil = 0
      let turns = new Set()
      const emit = (event) => {
        if (!stopped) onEvent(event)
      }
      const now = () => d.nowUs()
      const bytes = (value) => (value instanceof Uint8Array ? value : new Uint8Array(value))
      function syncTurns(state) {
        if (!state.activeTurns) return
        const next = new Set(state.activeTurns)
        for (const turnId of next) if (!turns.has(turnId)) emit({ type: 'turn.started', turnId })
        for (const turnId of turns) if (!next.has(turnId)) emit({ type: 'turn.settled', turnId })
        turns = next
      }
      function flush(clearWaiting = true) {
        const sounded = !!producer || speakerUntil > now()
        pending = []
        pendingBytes = 0
        if (clearWaiting) {
          waiting = []
          waitingBytes = 0
        }
        const targetGeneration = ++generation
        flushing++
        const previous = producer
        const link = outputLink
        producer = undefined
        outputLink = undefined
        outputId = undefined
        previous?.end()
        flushTask = flushTask
          .then(async () => {
            const fence = media.output.fence(targetGeneration)
            await link?.close()
            const receipts = await fence
            for (const receipt of receipts) emit({ type: 'output.playback', receipt })
            speakerUntil = sounded ? now() + 200000 : 0
            return receipts
          })
          .finally(() => {
            flushing--
            if (!flushing && pending.length && !enabled && !stopped && !finishing) void pump()
          })
        return flushTask
      }
      async function pump() {
        if (pumping || flushing || enabled || finishing || stopped) return
        pumping = true
        const pumpGeneration = generation
        pumpTask = (async () => {
          while (pending.length && !flushing && !enabled && !stopped && !finishing) {
            const item = pending.shift()
            pendingBytes -= item.data.byteLength
            if (item.generation !== generation) continue
            if (!producer) {
              const created = d.createPcmSource(FORMAT)
              const name = `${id}:${generation}`
              const target = media.output.begin(name, generation)
              const link = await media.media.connect(created.output, target, { signal, budget: BUDGET })
              if (item.generation !== generation || stopped || finishing) {
                created.end()
                await link.close()
                continue
              }
              producer = created
              outputLink = link
              outputId = name
              void link.done.catch(fail)
            }
            if (item.audible)
              speakerUntil = Math.max(speakerUntil - 200000, now()) + (item.data.length / 32000) * 1000000 + 200000
            const current = producer
            for (let offset = 0; offset < item.data.length; offset += 2048) {
              if (item.generation !== generation || stopped) break
              await current.push(item.data.subarray(offset, offset + 2048))
            }
          }
        })()
        try {
          await pumpTask
        } catch (e) {
          if (!finishing && !stopped && pumpGeneration === generation) fail(e)
        } finally {
          pumping = false
          if (pending.length && !flushing && !enabled && !finishing && !stopped) void pump()
        }
      }
      function enqueue(data, audible = true) {
        if (!data.length) return
        if (pendingBytes + data.length > MAX_PCM) throw error('input_overrun')
        pending.push({ data, generation, audible })
        pendingBytes += data.length
        void pump()
      }
      async function finish(aborted = false) {
        if (tearingDown || stopped) return
        tearingDown = true
        finishing = true
        live = false
        enabled = false
        if (tick !== undefined) d.clearTimer(tick)
        if (!closeMode) {
          if (deadline !== undefined) d.clearTimer(deadline)
          deadline = d.setTimer(() => {
            timedOut = true
            drainLimit.resolve()
          }, 10000)
        }
        native?.close()
        await inputLink?.close()
        let receipt
        try {
          if (aborted || closeMode === 'abort') {
            await flush()
            await pumpTask.catch(() => {})
          } else {
            try {
              await Promise.race([
                (async () => {
                  finishing = false
                  await flushTask
                  await pump()
                  await pumpTask
                  finishing = true
                  producer?.end()
                  await outputLink?.done
                  if (outputId) receipt = await media.output.finish(outputId)
                })(),
                drainLimit.promise.then(() => {
                  throw error('deadline_exceeded')
                }),
              ])
            } catch (e) {
              closeMode = 'abort'
              await flush()
              await pumpTask.catch(() => {})
              if (e.code !== 'deadline_exceeded' && !signal.aborted) throw e
            }
          }
          if (receipt) emit({ type: 'output.playback', receipt })
        } finally {
          await outputLink?.close()
          if (deadline !== undefined) d.clearTimer(deadline)
          signal.removeEventListener('abort', abort)
          core.close()
          stopped = true
          rx = microphone = undefined
          pending = waiting = []
        }
        ready.reject(error('provider_failed'))
        const result = {
          reason: timedOut ? 'drain-timeout' : aborted || closeMode === 'abort' ? 'aborted' : 'drained',
          remoteFinalization: confirmed ? 'confirmed' : 'unknown',
        }
        ended.resolve(result)
        try {
          onEvent({ type: 'session.ended', result })
        } catch {}
      }
      function finishSafely(aborted) {
        void finish(aborted).catch((e) => {
          stopped = true
          ready.reject(e)
          ended.reject(e)
        })
      }
      function actions(state) {
        if (stopped) return
        held = !!state.held
        if (state.actions & 128) {
          micSize = 0
          core.action('discard', now())
          quietNext = now() + 20000
          nextSend = now()
        }
        syncTurns(state)
        if (state.gateFull) throw error('resource_exhausted')
        if (state.gateFlush & 2) {
          waiting = []
          waitingBytes = 0
        }
        if (state.actions & 16 || state.gateFlush & 1) void flush(!!(state.actions & 16)).catch(fail)
        if (state.actions & 32) {
          live = true
          ready.resolve(call)
        }
        if (state.actions & 1) {
          native.endCall(END, d.encode(core.endCallBody(d.wallMs(), now())))
          core.action('endSent', now())
        }
        if (state.actions & 2) native.bodyChunk(MEDIA, new ArrayBuffer(0), true)
        if (state.actions & 4) native.resetStream(MEDIA)
        if (state.actions & 8) native.resetStream(END)
        if (state.actions & 64)
          finishSafely(state.reason !== 1 && state.reason !== 2 && state.reason !== 7 && state.reason !== 8)
      }
      function fail(connectionLost = false) {
        if (stopped || tearingDown) return
        emit({ type: 'error', code: 'provider_failed', fatal: true })
        ready.reject(error('provider_failed'))
        enabled = false
        try {
          if (!admitted) finishSafely(true)
          else if (connectionLost === true) actions(core.action('lost', now()))
          else {
            if (!closeMode) {
              closeMode = 'abort'
              if (deadline !== undefined) d.clearTimer(deadline)
              deadline = d.setTimer(() => finishSafely(true), 10000)
            }
            actions(core.action('hangUp', now()))
          }
        } catch {
          finishSafely(true)
        }
      }
      function line(value) {
        const state = core.event(value, now())
        actions(state)
        if (finishing || stopped) return
        if (!state.gateWaiting && waiting.length) {
          const heldAudio = waiting
          waiting = []
          waitingBytes = 0
          if (state.gatePlaying) for (const item of heldAudio) enqueue(item.data, item.audible)
        }
        if (state.kind === 12 && state.text) {
          if (state.type.endsWith('.delta'))
            emit({ type: 'input.transcript.delta', streamId: state.itemId || id, delta: state.text })
          else
            emit({
              type: 'input.transcript',
              value: { utteranceId: state.itemId || id, text: state.text, final: true },
            })
        }
        if (state.kind === 10 && state.text && state.captionsAllowed)
          emit({ type: 'output.text', outputId: state.responseMessageId || id, delta: state.text })
        if (state.kind === 14) diagnostic('bridge_server_error')
        if (state.kind === 14) emit({ type: 'error', code: 'provider_failed', fatal: state.state !== 3 })
        if (state.pcm && closeMode !== 'abort') {
          const data = bytes(state.pcm)
          if (state.gateVerdict === 1) {
            if (waitingBytes + data.length > MAX_PCM) {
              waiting = []
              waitingBytes = 0
              actions(core.action('overflow', now()))
            } else {
              waiting.push({ data, audible: !!state.audible })
              waitingBytes += data.length
            }
          } else if (state.gateVerdict === 2) enqueue(data, !!state.audible)
          if (state.audible) core.action('activity', now())
        }
      }
      function feed(data) {
        for (const byte of bytes(data)) {
          if (byte === 10) {
            if (rxSize) line(d.decode(rx.subarray(0, rxSize)))
            rxSize = 0
            if (finishing || stopped) return
          } else {
            if (rxSize >= MAX_LINE) throw error('resource_exhausted')
            rx[rxSize++] = byte
          }
        }
      }
      function network(type, data) {
        if (stopped || tearingDown) return
        let stage = 'event'
        try {
          if (type === 1) {
            diagnostic('bridge_websocket_open')
            native.start()
          } else if (type === 2 && handshaking) {
            native.handshake(data)
            diagnostic('bridge_noise_ready')
            handshaking = false
            admitted = true
            core.begin(id, now())
            native.voiceRequest(MEDIA, id, d.encode(core.admission(id, configuration.nodeId, false)))
            native.bodyChunk(MEDIA, d.encode('{"type":"hatch.voice.capability.offer","end_call_stop":1}\n'), false)
            diagnostic('bridge_admission_sent')
          } else if (type === 2) {
            stage = 'decode'
            const frame = native.receive(data)
            if (!frame) return
            if (frame.stream === END) {
              if (frame.kind === 2) endStatus = frame.status
              if (frame.end || frame.kind === 4) {
                confirmed = frame.kind !== 4 && endStatus >= 200 && endStatus < 300
                actions(core.action('endDone', now()))
              }
            } else if (frame.stream === MEDIA) {
              if (frame.kind === 2) {
                stage = 'head'
                if (frame.status >= 400)
                  diagnostic('bridge_error_body_' + classifyMuseFailureBody(d.decode(frame.body ?? new ArrayBuffer(0))))
                diagnostic(
                  'bridge_response_' +
                    ([200, 400, 401, 403, 404, 409, 429, 500, 503].includes(frame.status)
                      ? String(frame.status)
                      : 'other'),
                )
                actions(core.head(frame.status, now()))
              }
              if (frame.body?.byteLength) {
                stage = 'body'
                feed(frame.body)
              }
              if (!stopped && !finishing && (frame.end || frame.kind === 4))
                actions(core.action('mediaEnd', now(), frame.kind !== 4))
            }
          } else if (type === 3 || type === 4) {
            const reasons = [
              'unknown',
              'certificate',
              'tls',
              'unauthorized',
              'forbidden',
              'http',
              'handshake',
              'transport',
              'timeout',
              'certificate_expired',
              'certificate_future',
              'certificate_name',
              'certificate_trust',
            ]
            const code = data?.byteLength === 1 ? new Uint8Array(data)[0] : 0
            diagnostic('bridge_failure_' + (reasons[code] ?? 'unknown'))
            fail(true)
          }
        } catch {
          diagnostic('bridge_failed_' + stage)
          fail()
        }
      }
      function poll() {
        if (stopped || tearingDown) return
        try {
          if (admitted) actions(core.action('poll', now()))
          if (live && !closeMode && !held) {
            if (enabled) core.action('activity', now())
            if (micSize && now() >= nextSend) {
              const result = core.uplink(microphone.subarray(0, micSize), now())
              if (result.consumed) {
                microphone.copyWithin(0, result.consumed, micSize)
                micSize -= result.consumed
              }
              if (result.line) {
                native.bodyChunk(MEDIA, d.encode(result.line), false)
                nextSend = now() + 40000
                quietNext = nextSend
              }
            } else if (!enabled && !micSize && now() >= quietNext) {
              const result = core.uplink(quiet, now())
              quietNext = now() + 20000
              if (result.line) native.bodyChunk(MEDIA, d.encode(result.line), false)
            }
          }
        } catch {
          fail()
        }
        if (!stopped && !finishing) tick = d.setTimer(poll, 10)
      }
      const abort = () => {
        if (tearingDown) {
          closeMode = 'abort'
          drainLimit.resolve()
        } else void call.close({ mode: 'abort' }).catch(() => {})
      }
      const call = {
        id,
        async setInputEnabled(value) {
          if (stopped || finishing || closeMode) throw error('cancelled')
          const revision = ++inputRevision
          if (!value) {
            enabled = false
            void pump()
            return
          }
          if (enabled) return
          enabled = true
          core.action('press', now())
          micSize = 0
          quietNext = now()
          await flush()
          if (revision !== inputRevision || stopped || tearingDown || closeMode) return
        },
        async interrupt() {
          if (stopped) throw error('cancelled')
          core.action('press', now())
          return flush()
        },
        close(options) {
          if (closeMode || stopped || finishing) return ended.promise
          closeMode = options.mode
          inputRevision++
          enabled = false
          micSize = 0
          if (closeMode === 'abort') void flush().catch(fail)
          if (deadline !== undefined) d.clearTimer(deadline)
          deadline = d.setTimer(() => {
            timedOut = options.mode === 'drain'
            if (tearingDown) drainLimit.resolve()
            else finishSafely(true)
          }, options.timeoutMs ?? 10000)
          try {
            if (admitted) actions(core.action('hangUp', now()))
            else finishSafely(true)
          } catch {
            fail()
          }
          return ended.promise
        },
      }
      try {
        const sink = d.createPcmSink(FORMAT, (chunk) => {
          if (!live || !enabled || held || flushing || now() < speakerUntil || finishing || stopped) {
            return
          }
          const data = bytes(chunk)
          if (data.length + micSize > microphone.length) throw error('input_overrun')
          microphone.set(data, micSize)
          micSize += data.length
        })
        diagnostic('bridge_input_connect')
        inputLink = await media.media.connect(media.input, sink, { signal, budget: BUDGET })
        void inputLink.done.catch(fail)
        diagnostic('bridge_native_open')
        native = d.openNative(configuration, network)
        diagnostic('bridge_native_ready')
        deadline = d.setTimer(() => {
          if (!live) {
            diagnostic('bridge_admission_timeout')
            fail()
          }
        }, 15000)
        signal.addEventListener('abort', abort)
        if (signal.aborted) abort()
        poll()
        return await ready.promise
      } catch (e) {
        if (!stopped && !tearingDown && !closeMode) finishSafely(true)
        await ended.promise.catch(() => {})
        throw e
      }
    },
  }
}
