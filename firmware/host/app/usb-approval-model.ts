export const STACKCHAN_EVENT_SCHEMA = 'stackchan.event.v1'

export type UsbApprovalKind = 'command' | 'fileChange'
export type UsbApprovalDecision = 'approve' | 'decline'

export type UsbApprovalRequest = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.request'
  requestId: string
  kind: UsbApprovalKind
  title: string
  summary: string
  detail: string
  truncated: boolean
}

export type UsbApprovalResolved = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.resolved'
  requestId: string
  message?: string
}

export type UsbApprovalSuspended = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.suspended'
  requestId: string
}

export type UsbApprovalInboundEvent = UsbApprovalRequest | UsbApprovalResolved | UsbApprovalSuspended

export type UsbApprovalPresented = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.presented'
  requestId: string
}

export type UsbApprovalResponse = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.response'
  requestId: string
  decision: UsbApprovalDecision
}

export function parseUsbApprovalEvent(value: unknown): UsbApprovalInboundEvent | undefined {
  if (!isRecord(value) || value.schema !== STACKCHAN_EVENT_SCHEMA) return
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) return
  switch (value.type) {
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
      return value as UsbApprovalRequest
    case 'approval.resolved':
      if (value.message !== undefined && typeof value.message !== 'string') return
      return value as UsbApprovalResolved
    case 'approval.suspended':
      return value as UsbApprovalSuspended
    default:
      return
  }
}

export function approvalPresented(requestId: string): UsbApprovalPresented {
  return {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.presented',
    requestId,
  }
}

export function approvalResponse(requestId: string, decision: UsbApprovalDecision): UsbApprovalResponse {
  return {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.response',
    requestId,
    decision,
  }
}

/**
 * Wrap text using the fixed-width 8 px UI font and split it into screen-sized
 * pages. This is deliberately independent from Piu so the USB contract and
 * pagination behavior can be covered by Node tests.
 */
export function paginateApprovalDetail(value: string, columns = 36, rows = 8): string[] {
  if (!Number.isInteger(columns) || columns < 1) throw new RangeError('columns must be a positive integer')
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError('rows must be a positive integer')

  const lines: string[] = []
  for (const sourceLine of value.replace(/\r\n?/g, '\n').split('\n')) {
    const characters = Array.from(sourceLine.replace(/\t/g, '  '))
    if (characters.length === 0) {
      lines.push('')
      continue
    }
    for (let offset = 0; offset < characters.length; offset += columns) {
      lines.push(characters.slice(offset, offset + columns).join(''))
    }
  }

  const pages: string[] = []
  for (let offset = 0; offset < lines.length; offset += rows) {
    pages.push(lines.slice(offset, offset + rows).join('\n'))
  }
  return pages.length > 0 ? pages : ['']
}

export function fitApprovalTitle(value: string, columns = 30): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  const characters = Array.from(compact)
  if (characters.length <= columns) return compact
  return `${characters.slice(0, Math.max(0, columns - 1)).join('')}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
