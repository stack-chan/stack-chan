import assert from 'node:assert/strict'
import test from 'node:test'
import { installRemoteSessionTestAliases } from './__tests__/node-aliases.js'

installRemoteSessionTestAliases()

const {
  approvalPresented,
  approvalResponse,
  fitApprovalTitle,
  paginateApprovalDetail,
  parseApprovalEvent,
  STACKCHAN_EVENT_SCHEMA,
} = await import('./approval-model.js')

test('parses supported approval requests and rejects malformed application events', () => {
  const request = {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.request',
    requestId: 'request-1',
    kind: 'command',
    title: 'コマンド実行の承認',
    summary: 'npm test',
    detail: 'コマンド:\nnpm test',
    truncated: false,
  }

  assert.deepEqual(parseApprovalEvent(request), request)
  assert.equal(parseApprovalEvent({ ...request, kind: 'network' }), undefined)
  assert.equal(parseApprovalEvent({ ...request, requestId: '' }), undefined)
  assert.equal(parseApprovalEvent({ ...request, schema: 'other.v1' }), undefined)
})

test('parses resolved and suspended events', () => {
  assert.deepEqual(
    parseApprovalEvent({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'approval.resolved',
      requestId: 'request-1',
      message: '処理済み',
    }),
    {
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'approval.resolved',
      requestId: 'request-1',
      message: '処理済み',
    },
  )
  assert.deepEqual(
    parseApprovalEvent({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'approval.suspended',
      requestId: 'request-1',
    }),
    {
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'approval.suspended',
      requestId: 'request-1',
    },
  )
})

test('builds namespaced acknowledgement and decision events', () => {
  assert.deepEqual(approvalPresented('request-1'), {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.presented',
    requestId: 'request-1',
  })
  assert.deepEqual(approvalResponse('request-1', 'approve'), {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.response',
    requestId: 'request-1',
    decision: 'approve',
  })
})

test('paginates fixed-width detail without splitting Unicode code points', () => {
  assert.deepEqual(paginateApprovalDetail('123456\nあいうえお', 4, 2), ['1234\n56', 'あいうえ\nお'])
  assert.deepEqual(paginateApprovalDetail('😀😀😀', 2, 1), ['😀😀', '😀'])
  assert.deepEqual(paginateApprovalDetail('', 4, 2), [''])
})

test('fits single-line titles', () => {
  assert.equal(fitApprovalTitle('  コマンド   実行  ', 10), 'コマンド 実行')
  assert.equal(fitApprovalTitle('1234567890', 5), '1234…')
})
