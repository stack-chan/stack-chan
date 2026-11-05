// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

const messages = {
  https_connection_failed: 'HTTPS connection failed',
  https_timeout: 'HTTPS request timed out',
  https_write_failed: 'HTTPS write failed',
  https_read_failed: 'HTTPS read failed',
  https_response_limit: 'HTTPS response exceeds limit',
  https_request_failed: 'HTTPS request failed',
  https_capacity: 'HTTPS request capacity',
  https_ipc_failed: 'HTTPS worker IPC failed',
}
export function safeHttpCode(error) {
  try {
    const code = error?.code
    if (typeof code === 'string' && Object.hasOwn(messages, code)) return code
  } catch {}
  return 'https_request_failed'
}
export function httpFailure(code) {
  code = safeHttpCode({ code })
  const error = new Error(messages[code])
  error.code = code
  error.stage = 'https'
  return error
}
