import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { installUsbAudioTestAliases } from './__tests__/node-aliases.js'
import {
  isValidStatusControl,
  isWithinSpeakerCredit,
  MediaSessionResult,
  StackChanCapability,
  StackChanStatus,
} from './media-session.js'

installUsbAudioTestAliases()

const { MicrophoneSessionGuard } = await import('./microphone-session.js')
const { SpeakerSessionGuard } = await import('./speaker-session.js')

type Step = {
  operation: string
  streamId?: number
  sampleRate?: number
  payloadBytes?: number
  expected?: string | boolean
  expectedStreamId?: number
  expectedSampleRate?: number
}

type MediaFixture = {
  protocolVersion: number
  microphoneScenarios: Array<{ name: string; steps: Step[] }>
  speakerScenarios: Array<{ name: string; steps: Step[] }>
  creditBoundaries: Array<{ payloadBytes: number; outstandingCreditBytes: number; accepted: boolean }>
}

const fixture = JSON.parse(
  readFileSync('host/modules/usb-audio/contracts/media-session-v2.json', 'utf8'),
) as MediaFixture

test('microphone state machine follows the media-session v2 vectors', () => {
  assert.equal(fixture.protocolVersion, 2)
  for (const scenario of fixture.microphoneScenarios) {
    const session = new MicrophoneSessionGuard()
    for (const step of scenario.steps) {
      switch (step.operation) {
        case 'start':
          assert.equal(
            session.start(streamId(step), sampleRate(step), payloadBytes(step)),
            step.expected,
            scenario.name,
          )
          break
        case 'stop':
          assert.equal(session.stop(streamId(step), sampleRate(step), payloadBytes(step)), step.expected, scenario.name)
          break
        case 'forceStop':
          assert.equal(session.forceStop(), step.expectedStreamId, scenario.name)
          break
        case 'reset':
          session.reset()
          break
        default:
          assert.fail(`unsupported microphone operation: ${step.operation}`)
      }
    }
  }
})

test('speaker state machine follows the media-session v2 vectors', () => {
  for (const scenario of fixture.speakerScenarios) {
    const session = new SpeakerSessionGuard()
    for (const step of scenario.steps) {
      switch (step.operation) {
        case 'start':
          assert.equal(
            session.start(streamId(step), sampleRate(step), payloadBytes(step)),
            step.expected,
            scenario.name,
          )
          break
        case 'end':
          assert.equal(session.end(streamId(step), sampleRate(step), payloadBytes(step)), step.expected, scenario.name)
          break
        case 'abort':
          assert.equal(
            session.abort(streamId(step), sampleRate(step), payloadBytes(step)),
            step.expected,
            scenario.name,
          )
          break
        case 'validateData':
          assert.equal(
            session.validateData(streamId(step), sampleRate(step), payloadBytes(step)),
            step.expected,
            scenario.name,
          )
          break
        case 'clear':
          assert.equal(session.clear(streamId(step)), step.expected, scenario.name)
          break
        case 'forceStop':
          assert.deepEqual(
            session.forceStop(),
            { streamId: step.expectedStreamId, sampleRate: step.expectedSampleRate },
            scenario.name,
          )
          break
        default:
          assert.fail(`unsupported speaker operation: ${step.operation}`)
      }
    }
  }
})

test('speaker credit accepts the exact boundary and rejects overflow', () => {
  for (const vector of fixture.creditBoundaries) {
    assert.equal(
      isWithinSpeakerCredit(vector.payloadBytes, vector.outstandingCreditBytes),
      vector.accepted,
      JSON.stringify(vector),
    )
  }
  assert.equal(MediaSessionResult.ACCEPTED, 'accepted')
})

test('status validation exhausts basic and extended capability boundaries', () => {
  for (const supportsExtended of [false, true]) {
    const capabilities = supportsExtended ? StackChanCapability.STATUS_EXTENDED : 0
    const maximum = supportsExtended ? StackChanStatus.ERROR : StackChanStatus.SPEAKING
    for (let status = StackChanStatus.IDLE - 1; status <= StackChanStatus.ERROR + 1; status += 1) {
      const expected = status >= StackChanStatus.IDLE && status <= maximum
      assert.equal(
        isValidStatusControl(0, 0, 1, status, capabilities),
        expected,
        JSON.stringify({ supportsExtended, status }),
      )
    }
  }

  assert.equal(isValidStatusControl(1, 0, 1, StackChanStatus.IDLE, StackChanCapability.STATUS_EXTENDED), false)
  assert.equal(isValidStatusControl(0, 1, 1, StackChanStatus.IDLE, StackChanCapability.STATUS_EXTENDED), false)
  assert.equal(isValidStatusControl(0, 0, 0, StackChanStatus.IDLE, StackChanCapability.STATUS_EXTENDED), false)
})

function streamId(step: Step): number {
  assert.equal(typeof step.streamId, 'number')
  return step.streamId
}

function sampleRate(step: Step): number {
  assert.equal(typeof step.sampleRate, 'number')
  return step.sampleRate
}

function payloadBytes(step: Step): number {
  assert.equal(typeof step.payloadBytes, 'number')
  return step.payloadBytes
}
