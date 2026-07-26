export {
  type ApprovalDecision,
  type ApprovalInboundEvent,
  type ApprovalKind,
  type ApprovalPresented,
  type ApprovalRequest,
  type ApprovalResolved,
  type ApprovalResponse,
  type ApprovalSuspended,
  approvalPresented,
  approvalResponse,
  parseApprovalEvent,
  STACKCHAN_EVENT_SCHEMA,
} from 'stackchan-application-event'

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
