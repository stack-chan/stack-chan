let nextStatus = 'running'
let nextError

export function setMCPServerResult(status, error) {
  nextStatus = status
  nextError = error
}

export class MCPServerService {
  constructor() {
    this.status = nextStatus
    this.error = nextError
  }
}
