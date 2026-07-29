import type { RemoteConversationState } from 'capabilities'

export const STACKCHAN_EVENT_SCHEMA = 'stackchan.event.v1'

export type ApprovalKind = 'command' | 'fileChange'
export type ApprovalDecision = 'approve' | 'decline'

export type ConversationStart = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'conversation.start'
  requestId: string
  source: 'headTouch'
  gesture: 'forwardSwipe'
}

export type ConversationStop = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'conversation.stop'
  requestId: string
  source: 'headTouch'
  gesture: 'backwardSwipe'
}

export type ConversationResult = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'conversation.result'
  requestId: string
  success: boolean
  state: RemoteConversationState
  error?: string
}

export type ApprovalRequest = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.request'
  requestId: string
  kind: ApprovalKind
  title: string
  summary: string
  detail: string
  truncated: boolean
}

export type ApprovalResolved = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.resolved'
  requestId: string
  message?: string
}

export type ApprovalSuspended = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.suspended'
  requestId: string
}

export type ApprovalPresented = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.presented'
  requestId: string
}

export type ApprovalResponse = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.response'
  requestId: string
  decision: ApprovalDecision
}

export type ApprovalInboundEvent = ApprovalRequest | ApprovalResolved | ApprovalSuspended
export type StackchanInboundApplicationEvent = ConversationResult | ApprovalInboundEvent
export type StackchanOutboundApplicationEvent =
  | ConversationStart
  | ConversationStop
  | ApprovalPresented
  | ApprovalResponse

export function isStackchanApplicationEventEnvelope(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schema === STACKCHAN_EVENT_SCHEMA
}

export function parseStackchanApplicationEvent(value: unknown): StackchanInboundApplicationEvent | undefined {
  if (!isStackchanApplicationEventEnvelope(value) || !hasRequestId(value)) return
  switch (value.type) {
    case 'conversation.result':
      if (
        typeof value.success !== 'boolean' ||
        !isRemoteConversationState(value.state) ||
        (value.error !== undefined && typeof value.error !== 'string')
      ) {
        return
      }
      return value as ConversationResult
    case 'approval.request':
      if (
        (value.kind !== 'command' && value.kind !== 'fileChange') ||
        typeof value.title !== 'string' ||
        typeof value.summary !== 'string' ||
        typeof value.detail !== 'string' ||
        typeof value.truncated !== 'boolean'
      ) {
        return
      }
      return value as ApprovalRequest
    case 'approval.resolved':
      if (value.message !== undefined && typeof value.message !== 'string') return
      return value as ApprovalResolved
    case 'approval.suspended':
      return value as ApprovalSuspended
    default:
      return
  }
}

export function parseApprovalEvent(value: unknown): ApprovalInboundEvent | undefined {
  const event = parseStackchanApplicationEvent(value)
  return event?.type === 'approval.request' ||
    event?.type === 'approval.resolved' ||
    event?.type === 'approval.suspended'
    ? event
    : undefined
}

export function conversationRequest(
  operation: 'start' | 'stop',
  requestId: string,
): ConversationStart | ConversationStop {
  return operation === 'start'
    ? {
        schema: STACKCHAN_EVENT_SCHEMA,
        type: 'conversation.start',
        requestId,
        source: 'headTouch',
        gesture: 'forwardSwipe',
      }
    : {
        schema: STACKCHAN_EVENT_SCHEMA,
        type: 'conversation.stop',
        requestId,
        source: 'headTouch',
        gesture: 'backwardSwipe',
      }
}

export function approvalPresented(requestId: string): ApprovalPresented {
  return {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.presented',
    requestId,
  }
}

export function approvalResponse(requestId: string, decision: ApprovalDecision): ApprovalResponse {
  return {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.response',
    requestId,
    decision,
  }
}

function hasRequestId(value: Record<string, unknown>): value is Record<string, unknown> & { requestId: string } {
  return typeof value.requestId === 'string' && value.requestId.length > 0
}

function isRemoteConversationState(value: unknown): value is RemoteConversationState {
  return (
    value === 'standby' ||
    value === 'connecting' ||
    value === 'listening' ||
    value === 'recognizing' ||
    value === 'speaking' ||
    value === 'blocked'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
