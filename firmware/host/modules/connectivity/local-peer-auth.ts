import { Digest } from 'crypt'
import { copyArrayBuffer, encodeUTF8 } from 'local-peer-codec'

const AUTHENTICATION_KEY_DOMAIN = 'stackchan-local-peer-auth-v1:'
const SHA256_BLOCK_BYTES = 64
export const LOCAL_PEER_AUTH_TAG_BYTES = 16

function concatenate(parts: readonly Uint8Array[]): ArrayBuffer {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result.buffer
}

function sha256(parts: readonly Uint8Array[]): Uint8Array {
  const digest = new Digest('SHA256')
  for (const part of parts) digest.write(copyArrayBuffer(part))
  return new Uint8Array(digest.close())
}

export function deriveLocalPeerAuthenticationKey(sharedKey: string): Uint8Array {
  return sha256([encodeUTF8(AUTHENTICATION_KEY_DOMAIN), encodeUTF8(sharedKey)])
}

export function createLocalPeerAuthenticationTag(
  authenticationKey: Uint8Array,
  source: Uint8Array,
  destination: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const innerPad = new Uint8Array(SHA256_BLOCK_BYTES)
  const outerPad = new Uint8Array(SHA256_BLOCK_BYTES)
  for (let index = 0; index < SHA256_BLOCK_BYTES; index += 1) {
    const value = authenticationKey[index] ?? 0
    innerPad[index] = value ^ 0x36
    outerPad[index] = value ^ 0x5c
  }
  const inner = sha256([innerPad, source, destination, data])
  return sha256([outerPad, inner]).subarray(0, LOCAL_PEER_AUTH_TAG_BYTES)
}

export function authenticationTagsEqual(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.byteLength !== expected.byteLength) return false
  let difference = 0
  for (let index = 0; index < actual.byteLength; index += 1) difference |= actual[index] ^ expected[index]
  return difference === 0
}

export function authenticatedLocalPeerRecord(
  authenticationKey: Uint8Array,
  source: Uint8Array,
  destination: Uint8Array,
  data: Uint8Array,
): ArrayBuffer {
  return concatenate([data, createLocalPeerAuthenticationTag(authenticationKey, source, destination, data)])
}
