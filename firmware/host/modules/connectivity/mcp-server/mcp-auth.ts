export type MCPAuthFailureReason = 'missing-token-configuration' | 'missing-authorization' | 'invalid-authorization'

export type MCPAuthResult =
  | {
      authorized: true
    }
  | {
      authorized: false
      reason: MCPAuthFailureReason
    }

export function normalizeMCPToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const token = value.trim()
  return token.length > 0 ? token : undefined
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }

  return difference === 0
}

export function authorizeMCPRequest(authorization: unknown, configuredToken: unknown): MCPAuthResult {
  const token = normalizeMCPToken(configuredToken)
  if (!token) {
    return { authorized: false, reason: 'missing-token-configuration' }
  }

  if (typeof authorization !== 'string' || authorization.trim().length === 0) {
    return { authorized: false, reason: 'missing-authorization' }
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match || !constantTimeEqual(match[1].trim(), token)) {
    return { authorized: false, reason: 'invalid-authorization' }
  }

  return { authorized: true }
}
