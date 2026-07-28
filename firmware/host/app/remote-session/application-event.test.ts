import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  approvalPresented,
  approvalResponse,
  conversationRequest,
  parseStackchanApplicationEvent,
  STACKCHAN_EVENT_SCHEMA,
} from './application-event.js'

type ApplicationEventFixture = {
  applicationSchema: string
  acceptedInbound: Array<Record<string, unknown>>
  rejectedInbound: Array<Record<string, unknown>>
  outbound: Array<{
    builder: string
    requestId: string
    expected: Record<string, unknown>
  }>
}

type SharedApplicationEventFixture = {
  applicationSchema: string
  vectors: Array<{
    name: string
    codexParserAccepted: boolean
    value: Record<string, unknown>
  }>
}

const fixture = JSON.parse(
  readFileSync('host/app/remote-session/application-event-v1.json', 'utf8'),
) as ApplicationEventFixture
const sharedFixture = JSON.parse(
  readFileSync('vendor/stack-chan-dock/contracts/usb-cdc-v2/application-event-vectors.json', 'utf8'),
) as SharedApplicationEventFixture

test('application-event v1 fixture accepts every supported inbound discriminant', () => {
  assert.equal(fixture.applicationSchema, STACKCHAN_EVENT_SCHEMA)
  for (const event of fixture.acceptedInbound) {
    assert.deepEqual(parseStackchanApplicationEvent(event), event, String(event.type))
  }
})

test('application-event v1 fixture rejects malformed and unknown messages', () => {
  for (const event of fixture.rejectedInbound) {
    assert.equal(parseStackchanApplicationEvent(event), undefined, String(event.type))
  }
})

test('application-event builders preserve the Android JSON shapes', () => {
  for (const vector of fixture.outbound) {
    let actual: unknown
    switch (vector.builder) {
      case 'conversation.start':
        actual = conversationRequest('start', vector.requestId)
        break
      case 'conversation.stop':
        actual = conversationRequest('stop', vector.requestId)
        break
      case 'approval.presented':
        actual = approvalPresented(vector.requestId)
        break
      case 'approval.response.approve':
        actual = approvalResponse(vector.requestId, 'approve')
        break
      default:
        assert.fail(`unsupported application-event builder: ${vector.builder}`)
    }
    assert.deepEqual(actual, vector.expected, vector.builder)
  }
})

test('conversation requests and results conform to the shared Dock fixture', () => {
  assert.equal(sharedFixture.applicationSchema, STACKCHAN_EVENT_SCHEMA)
  for (const vector of sharedFixture.vectors) {
    switch (vector.value.type) {
      case 'conversation.start':
        if (!vector.codexParserAccepted) break
        assert.deepEqual(conversationRequest('start', String(vector.value.requestId)), vector.value, vector.name)
        break
      case 'conversation.stop':
        if (!vector.codexParserAccepted) break
        assert.deepEqual(conversationRequest('stop', String(vector.value.requestId)), vector.value, vector.name)
        break
      case 'conversation.result':
        assert.deepEqual(parseStackchanApplicationEvent(vector.value), vector.value, vector.name)
        break
    }
  }
})
