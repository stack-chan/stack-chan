/*
 * Copyright (c) 2024-2026 Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import AudioIn from 'embedded:io/audio/in'
import AudioOut from 'embedded:io/audio/out'
import Worker from 'worker'

// Host-owned XiaoZhi adapter, derived from Moddable SDK 9.5 ChatAudioIO.
// Keep the upstream LGPL notice above. Other providers still use the SDK class.

function computeLevel(buffer) {
  return native('xs_computeLevel').call(this, buffer)
}

class ChatAudioIO {
  static FAILED = -1
  static DISCONNECTED = 0
  static DISCONNECTING = 1
  static CONNECTING = 2
  static CONNECTED = 3
  static SPEAKING = 4 // user is speaking (sending audio to cloud)
  static LISTENING = 5 // user is listening (receiving audio from cloud)
  static WAITING = 6
  static states = ['DISCONNECTED', 'DISCONNECTING', 'CONNECTING', 'CONNECTED', 'SPEAKING', 'LISTENING', 'WAITING']
  static {
    ChatAudioIO.states[-1] = 'FAILED'
    Object.freeze(ChatAudioIO.states)
  }

  constructor(options) {
    this.turnControl = options.turnControl ?? 'halfDuplex'
    if (!['halfDuplex', 'downlink'].includes(this.turnControl))
      throw new Error(this.turnControl === 'fullDuplex' ? 'fullDuplex is not implemented' : 'Invalid turnControl')
    this.turns = []
    this.playedBytes = 0
    this.generation = 0
    this.onOutputTurnStarted = options.onOutputTurnStarted ?? (() => {})
    this.onOutputTurnEnded = options.onOutputTurnEnded ?? (() => {})
    this.error = ''
    this.state = ChatAudioIO.DISCONNECTED

    this.input = null
    this.inputBufferOffset = 0
    this.inputBufferSize = 512 * 1024
    this.inputBuffer = this.turnControl === 'downlink' ? undefined : new SharedArrayBuffer(this.inputBufferSize)
    this.inputSampleRate = 24000
    this.ready = false

    this.output = null
    this.outputBufferSize = 512 * 1024
    this.outputBuffer = new SharedArrayBuffer(this.outputBufferSize)
    this.outputSampleRate = 24000
    this.outputBufferHead = 0
    this.outputBufferTail = 0
    this.barrier = new Int32Array(new SharedArrayBuffer(4))

    this.level = 0
    this.microphone = 1
    this.volume = 1

    const callback = () => {}
    this.onFunctionCall = options.onFunctionCall ?? callback
    this.onInputLevelChanged = options.onInputLevelChanged ?? callback
    this.onInputTranscript = options.onInputTranscript ?? callback
    this.onOutputLevelChanged = options.onOutputLevelChanged
    this.onOutputTranscript = options.onOutputTranscript ?? callback
    this.onStateChanged = options.onStateChanged ?? callback

    this.createWorker(
      options.specifier,
      options.instructions,
      options.functions,
      options.voiceID,
      options.providerID,
      options.modelID,
      options.apiKey,
    )
  }
  close() {
    this.clearOutput()
    this.worker?.terminate()
    this.worker = null
    this.output?.close()
    this.output = null
    this.input?.close()
    this.input = null
  }
  changeMicrophone(microphone) {
    this.microphone = microphone
  }
  changeVolume(volume) {
    this.volume = volume
    if (this.output) this.output.volume = volume
  }
  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
    this.worker = new Worker(specifier, {
      static: 512 * 1024,
      chunk: {
        initial: 64 * 1024,
        incremental: 8 * 1024,
      },
      heap: {
        initial: 1024,
        incremental: 256,
      },
      stack: 1024,
      nativeStack: 12 * 1024,
    })
    this.worker.onmessage = (message) => {
      this[message.id](message)
    }
    this.worker.postMessage({
      id: 'configure',
      instructions,
      functions,
      voiceID,
      providerID,
      modelID,
      apiKey,
    })
    this.ensureInput()
  }
  configureAudio(message) {
    const inputSampleRate = message.inputSampleRate ?? 24000
    if (this.inputSampleRate !== inputSampleRate) {
      this.inputSampleRate = inputSampleRate
      if (this.input) {
        this.input.close()
        this.input = null
        this.ensureInput()
      }
    }
    const outputSampleRate = message.outputSampleRate ?? 24000
    if (this.outputSampleRate !== outputSampleRate) {
      this.outputSampleRate = outputSampleRate
      if (this.output) {
        this.output.close()
        this.output = null
        this.ensureOutput()
      }
    }
  }
  connect() {
    this.state = ChatAudioIO.CONNECTING
    this.inputBufferOffset = 0
    Atomics.store(this.barrier, 0, 0)
    this.worker.postMessage({
      id: 'connect',
      inputBuffer: this.inputBuffer,
      outputBuffer: this.outputBuffer,
      barrier: this.barrier,
    })
    this.onStateChanged(this.state)
  }
  connected() {
    this.state = ChatAudioIO.CONNECTED
    this.onStateChanged(this.state)
    if (this.turnControl === 'downlink') return
    this.state = ChatAudioIO.SPEAKING
    if (this.ready) this.onStateChanged(this.state)
  }
  disconnect() {
    this.clearOutput()
    this.state = ChatAudioIO.DISCONNECTING
    this.worker.postMessage({ id: 'disconnect' })
    this.onStateChanged(this.state)
  }
  disconnected() {
    this.clearOutput()
    this.error = ''
    this.state = ChatAudioIO.DISCONNECTED
    this.ensureInput()
    this.onStateChanged(this.state)
  }
  failed(message) {
    this.clearOutput()
    this.error = message.string
    this.state = ChatAudioIO.FAILED
    this.ensureInput()
    this.onStateChanged(this.state)
  }
  listen(message = {}) {
    if (this.turns.length >= 64) return this.failed({ string: 'Too many queued XiaoZhi turns' })
    this.turns.push({ id: message.turnId, generation: this.generation, calls: [] })
    if (this.turns.length === 1) this.beginOutputTurn()
  }
  receiveAudio(message) {
    this.outputBufferHead = message.offset + message.size
  }
  receiveFunctionCall(message) {
    const turn = this.turns.find((turn) => turn.id === message.turnId)
    if (turn && !turn.ready) {
      if (turn.calls.length >= 32) return this.failed({ string: 'Too many queued XiaoZhi tool calls' })
      turn.calls.push(message)
      return
    }
    this.onFunctionCall(message.call, message.name, message.parameters)
  }
  receiveInputText(message) {
    this.onInputTranscript(message.text, message.more)
  }
  receiveOutputText(message) {
    this.onOutputTranscript(message.text, message.more)
  }
  sendFunctionResult(call, name, result) {
    this.worker.postMessage({ id: 'sendFunctionResult', call, name, result })
  }
  sendText(text) {
    if (this.state < ChatAudioIO.CONNECTED) throw new Error('not connected')
    if (this.state > ChatAudioIO.SPEAKING) throw new Error('listening')
    this.worker.postMessage({ id: 'sendText', text })
  }
  speak(message = {}) {
    const turn = this.turns.find((turn) => turn.id === message.turnId)
    if (turn) turn.end = message.endByte
  }
  clearOutput() {
    this.generation++
    this.turns.length = 0
    this.playedBytes = 0
    this.outputBufferHead = this.outputBufferTail = 0
    this.output?.close()
    this.output = null
    // Wake a decoder waiting for ring space before terminating its Worker.
    Atomics.store(this.barrier, 0, -1)
    Atomics.notify(this.barrier, 0)
  }
  beginOutputTurn() {
    const turn = this.turns[0]
    if (!turn || turn.begun) return
    turn.begun = true
    turn.context = { id: turn.id, isCurrent: () => this.turns[0] === turn && turn.generation === this.generation }
    this.settleTurnHook(
      turn,
      () => this.onOutputTurnStarted(turn.context),
      () => {
        turn.ready = true
        for (const call of turn.calls) this.receiveFunctionCall(call)
        turn.calls.length = 0
        this.state = ChatAudioIO.LISTENING
        this.ensureOutput()
        this.onStateChanged(this.state)
      },
    )
  }
  settleTurnHook(turn, operation, continuation) {
    const resume = () => {
      if (!turn.context.isCurrent()) return
      try {
        continuation()
      } catch (error) {
        fail(error)
      }
    }
    const fail = (error) => {
      if (turn.context.isCurrent()) this.failed({ string: String(error?.message ?? error) })
    }
    try {
      const result = operation()
      if (result && typeof result.then === 'function') result.then(resume, fail)
      else resume()
    } catch (error) {
      fail(error)
    }
  }
  finishOutputTurn(turn) {
    if (turn.ending) return
    turn.ending = true
    this.settleTurnHook(
      turn,
      () => this.onOutputTurnEnded(turn.context),
      () => {
        this.turns.shift()
        if (this.turns.length) this.beginOutputTurn()
        else {
          this.output?.close()
          this.output = null
          this.state = this.turnControl === 'downlink' ? ChatAudioIO.CONNECTED : ChatAudioIO.SPEAKING
          this.worker?.postMessage({ id: 'listened' })
          this.ensureInput()
          this.onStateChanged(this.state)
        }
      },
    )
  }

  ensureInput() {
    if (this.turnControl === 'downlink') return
    if (this.input) return
    this.output?.close()
    this.output = null
    const when = Date.now() + 500
    this.input = new AudioIn({
      sampleRate: this.inputSampleRate,
      onReadable: (size) => {
        if (!this.ready) {
          if (Date.now() >= when) {
            this.ready = true
            if (this.state !== ChatAudioIO.DISCONNECTED) this.onStateChanged(this.state)
          } else return
        }
        if (!this.microphone) return
        let delta = this.inputBufferSize - this.inputBufferOffset
        if (delta < size) {
          this.inputBufferOffset = 0
          delta = this.inputBufferSize
        }
        const samples = new Uint8Array(this.inputBuffer, this.inputBufferOffset, size)
        this.input.read(samples)
        const level = computeLevel(samples)
        if (this.level !== level) {
          this.level = level
          this.onInputLevelChanged(level)
        }
        if (this.state === ChatAudioIO.SPEAKING) {
          this.worker.postMessage({ id: 'sendAudio', offset: this.inputBufferOffset, size })
        }
        this.inputBufferOffset += size
      },
    })
    this.input.start()
  }
  ensureOutput() {
    if (this.output) return
    this.input?.close()
    this.input = null
    this.ready = false
    this.output = new AudioOut({
      sampleRate: this.outputSampleRate,
      onWritable: (size) => {
        const turn = this.turns[0]
        if (!turn?.ready || turn.ending) return
        // Drain notification follows the callback that submitted the final
        // samples; a following turn cannot overwrite a previous stop marker.
        if (turn.end !== undefined && this.playedBytes >= turn.end) {
          this.onOutputLevelChanged?.(0)
          this.finishOutputTurn(turn)
          return
        }
        let start = this.outputBufferTail
        const stop = this.outputBufferHead
        let remaining = (stop - start + this.outputBufferSize) % this.outputBufferSize
        if (turn.end !== undefined) remaining = Math.min(remaining, turn.end - this.playedBytes)
        remaining = Math.min(remaining, size)
        let level = 0
        while (remaining > 0) {
          const count = Math.min(remaining, this.outputBufferSize - start)
          const samples = new Uint8Array(this.outputBuffer, start, count)
          if (this.onOutputLevelChanged) level = Math.max(level, computeLevel(samples))
          this.output.write(samples)
          start = (start + count) % this.outputBufferSize
          remaining -= count
          this.playedBytes += count
        }
        this.outputBufferTail = start
        Atomics.store(this.barrier, 0, start)
        Atomics.notify(this.barrier, 0)
        if (this.level !== level) {
          this.level = level
          this.onOutputLevelChanged?.(level)
        }
      },
    })
    this.output.start()
    this.output.volume = this.volume
  }
}

export default ChatAudioIO
