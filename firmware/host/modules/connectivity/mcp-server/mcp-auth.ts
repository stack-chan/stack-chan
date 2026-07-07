export type MCPAuthFailureReason = 'token-not-configured' | 'missing-authorization' | 'invalid-authorization'

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

export function authorizeMCPRequest(authorization: unknown, configuredToken: unknown): MCPAuthResult {
  const token = normalizeMCPToken(configuredToken)
  if (!token) {
    return { authorized: false, reason: 'token-not-configured' }
  }

  if (typeof authorization !== 'string' || authorization.trim().length === 0) {
    return { authorized: false, reason: 'missing-authorization' }
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match || match[1].trim() !== token) {
    return { authorized: false, reason: 'invalid-authorization' }
  }

  return { authorized: true }
}
