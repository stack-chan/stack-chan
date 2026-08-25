export type ApprovalSession = {
  handleEvent(event: unknown): boolean
  close(): void
}

export function createApprovalSession(_transport: unknown, _context: unknown): ApprovalSession {
  return {
    handleEvent(_event) {
      return false
    },
    close() {},
  }
}
